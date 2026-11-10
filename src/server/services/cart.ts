/**
 * Cart — one per user per buyer company, LOCKED TO ONE SUPPLIER (wholesaler for a
 * customer, distributor for a wholesaler). The DB trigger enforces the lock too; here
 * we give a clear message and let the user check out or clear the cart first.
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { catalogueItem, pricedOffers } from "@/server/data/catalogue-buyer";
import { checkQty, computeLine } from "@/server/orders/calc";
import { priceCart } from "@/server/orders/pricing";
import { findCoupon } from "@/server/marketing/offers";
import { zoneIdsForAddress } from "@/server/delivery/coverage";
import { orderingMode, planRouted, routedOffers, type RoutedOffers } from "@/server/allocation/routed";
import { creditBlock } from "./payments";

function requireBuyer(ctx: Ctx) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.orders.place"))
    throw new ForbiddenError();
}

/** The user's cart; an empty cart follows the country's ordering mode (FIRINGI-routed or one supplier). */
async function cartRow(ctx: Ctx) {
  const routed = (await orderingMode(ctx)) === "FIRINGI";
  const include = { items: true, seller: { select: { id: true, legalName: true, tradeName: true } } } as const;
  const cart = await prisma.cart.upsert({
    where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } },
    update: {},
    create: { buyerCompanyId: ctx.company.id, userId: ctx.user.id, routed },
    include,
  });
  if (cart.routed !== routed && cart.items.length === 0)
    return prisma.cart.update({ where: { id: cart.id }, data: { routed, sellerCompanyId: null }, include });
  return cart;
}

const QTY_MESSAGES = {
  QTY_INVALID: "Enter a whole quantity.",
  QTY_MIN: "Below the minimum order quantity for this product.",
  QTY_STEP: "This product is sold in fixed multiples.",
} as const;

export async function addToCart(ctx: Ctx, offerId: string, qty: number) {
  requireBuyer(ctx);
  const { item } = await catalogueItem(ctx, offerId); // 404 unless visible to this buyer
  const cart = await cartRow(ctx);
  if (cart.routed !== ((await orderingMode(ctx)) === "FIRINGI"))
    throw new AppError("CART_MODE_CHANGED", "The way you order has changed. Please check out or clear your cart first.", 409);
  if (!cart.routed && cart.sellerCompanyId && cart.sellerCompanyId !== item.vendor.id) {
    const name = cart.seller?.tradeName ?? cart.seller?.legalName ?? "another supplier";
    throw new AppError(
      "CART_OTHER_SUPPLIER",
      `Your cart already has products from ${name}. You can buy from one supplier at a time — check out or clear your cart before adding products from ${item.vendor.name}.`,
      409,
      { current: name, next: item.vendor.name },
    );
  }
  const existing = cart.items.find((i) => i.offerId === offerId);
  const total = (existing?.qty ?? 0) + qty;
  const err = checkQty(total, item.minOrderQty, item.qtyStep);
  if (err) throw new ValidationError(`${QTY_MESSAGES[err]} (min ${item.minOrderQty}, step ${item.qtyStep})`);
  if (existing) await prisma.cartItem.update({ where: { id: existing.id }, data: { qty: total } });
  else await prisma.cartItem.create({ data: { cartId: cart.id, offerId, qty } });
  return { qty: total };
}

export async function setCartQty(ctx: Ctx, offerId: string, qty: number) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  const line = cart.items.find((i) => i.offerId === offerId);
  if (!line) throw new NotFoundError("Cart item");
  if (qty === 0) return removeFromCart(ctx, offerId);
  const { item } = await catalogueItem(ctx, offerId);
  const err = checkQty(qty, item.minOrderQty, item.qtyStep);
  if (err) throw new ValidationError(`${QTY_MESSAGES[err]} (min ${item.minOrderQty}, step ${item.qtyStep})`);
  await prisma.cartItem.update({ where: { id: line.id }, data: { qty } });
}

export async function removeFromCart(ctx: Ctx, offerId: string) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, offerId } }); // trigger unlocks when empty
}

export async function clearCart(ctx: Ctx) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}

/**
 * Enter a coupon code. Codes that can't work for this buyer (unknown, expired, used up, not for
 * them, another supplier's) are refused; whether it fits the cart (minimum order …) is shown in the cart.
 */
export async function applyCoupon(ctx: Ctx, code: string) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  const { promo } = await findCoupon(ctx, code, { sellerId: cart.sellerCompanyId, routed: cart.routed });
  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: promo.code } });
  return { code: promo.code! };
}

export async function removeCoupon(ctx: Ctx) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
}

export async function cartCount(ctx: Ctx) {
  if (!can(ctx, "buyer.orders.place") || ctx.company.status !== "APPROVED") return 0;
  return prisma.cartItem.count({ where: { cart: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } } });
}

/**
 * The rules that decide delivery for an order from `vendorCompanyId` to a buyer in
 * `buyerCountryId`: FIRINGI's rule (the delivery zone of `addressId` overrides the country)
 * and the vendor's own rule (free-delivery minimum, flat rate).
 */
export async function deliveryRulesFor(buyerCountryId: string, vendorCompanyId: string, addressId?: string | null) {
  const now = new Date();
  const valid = { isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
  const zones = addressId ? await zoneIdsForAddress(addressId) : [];
  const order = [{ priority: "desc" as const }, { validFrom: "desc" as const }];
  const [zone, country, vendor] = await Promise.all([
    zones.length ? prisma.deliveryRule.findFirst({ where: { ...valid, scope: "ZONE", zoneId: { in: zones } }, orderBy: order }) : null,
    prisma.deliveryRule.findFirst({ where: { ...valid, scope: "COUNTRY", countryId: buyerCountryId }, orderBy: order }),
    vendorCompanyId ? prisma.deliveryRule.findFirst({ where: { ...valid, scope: "VENDOR", vendorCompanyId }, orderBy: order }) : null,
  ]);
  return { firingi: zone ?? country, vendor };
}

/** Full cart view: priced lines, totals (incl. VAT), delivery decision. */
export async function cartView(ctx: Ctx) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  const addresses = await prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true, kind: "DELIVERY" }, orderBy: [{ isDefault: "desc" }, { label: "asc" }], include: { city: { select: { regionId: true } } } });
  if (cart.routed) {
    const ro = await routedOffers(ctx, cart.items.map((i) => ({ offerId: i.offerId, qty: i.qty })), cart.couponCode);
    const lines = ro.items.map((i) => {
      const c = computeLine({ qty: i.qty, unitListPriceNet: i.price?.unitPriceNet ?? 0, vatRatePercent: i.vatRate, commissionRatePercent: 0 });
      return { ...i, lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2), lineGross: c.lineNet.plus(c.lineVat).toFixed(2) };
    });
    // € off the order (FIRINGI offer / coupon), spread per unit: goods and VAT after it.
    let goodsNet = new Decimal(0), goodsVat = new Decimal(0), shown = new Decimal(0);
    for (const l of lines) {
      const c = computeLine({ qty: l.qty, unitListPriceNet: new Decimal(l.price?.unitPriceNet ?? 0).minus(ro.extra.get(l.offerId) ?? 0), vatRatePercent: l.vatRate, commissionRatePercent: 0 });
      goodsNet = goodsNet.plus(c.lineNet); goodsVat = goodsVat.plus(c.lineVat); shown = shown.plus(l.lineNet);
    }
    return routedCartView(ctx, cart, lines, ro, goodsNet, goodsVat, shown.minus(goodsNet), addresses);
  }
  const seller = cart.seller;
  const empty = { credit: null, routed: false as const, seller: null, lines: [], unavailable: [], taxLabel: "VAT", goodsNet: "0.00", goodsVat: "0.00", delivery: null, totalNet: "0.00", totalVat: "0.00", totalGross: "0.00", addresses, coupon: null, offerDiscount: "0.00", freeDelivery: null };
  if (!seller || !cart.items.length) return { ...empty, unavailable: cart.items.length ? cart.items.map((i) => i.offerId) : [] };
  const pc = await priceCart(ctx, { items: cart.items.map((i) => ({ offerId: i.offerId, qty: i.qty })), sellerId: seller.id, couponCode: cart.couponCode }, { regionId: addresses[0]?.city?.regionId ?? null, addressId: addresses[0]?.id ?? null });
  // Lines at their price after product offers (incl. a product coupon); € off the order is shown apart.
  const lines = pc.lines.map((l) => {
    const c = computeLine({ qty: l.item.qty, unitListPriceNet: l.item.price!.unitPriceNet, vatRatePercent: l.rate, commissionRatePercent: 0 });
    return { ...l.item, lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2), lineGross: c.lineNet.plus(c.lineVat).toFixed(2) };
  });
  const shownGoods = lines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
  const offerDiscount = shownGoods.minus(pc.totals.goodsNet); // € off the order (offer and/or coupon)
  const feeVat = pc.totals.deliveryFeeVat;
  const d = pc.decision;
  const credit = await creditBlock(ctx.company.id, pc.totals.grandTotal);
  return {
    credit,
    routed: false as const,
    seller: { id: seller.id, name: seller.tradeName ?? seller.legalName },
    lines,
    unavailable: pc.unavailable,
    taxLabel: lines[0]?.taxLabel ?? "VAT",
    goodsNet: pc.totals.goodsNet.toFixed(2),
    goodsVat: pc.totals.vatTotal.minus(feeVat).toFixed(2),
    delivery: d.ok
      ? { ok: true as const, mode: d.mode, feeNet: pc.chargedFee.toFixed(2), feeVat: feeVat.toFixed(2), feeVatRate: pc.feeVatRate.toString(), free: pc.freeDelivery ? ("OFFER" as const) : d.free }
      : { ok: false as const, reason: d.reason as "BELOW_MINIMUM" | "BELOW_SUPPLIER_MINIMUM" | "NOT_AVAILABLE_HERE", minimum: d.unit === "UNITS" ? String(d.minimum) : d.minimum.toFixed(2), missing: d.unit === "UNITS" ? String(d.missing) : d.missing.toFixed(2), unit: d.unit, vendorMinimum: d.vendorMinimum?.toFixed(2) ?? null },
    totalNet: pc.totals.netTotal.toFixed(2),
    totalVat: pc.totals.vatTotal.toFixed(2),
    totalGross: pc.totals.grandTotal.toFixed(2),
    addresses,
    offerDiscount: offerDiscount.gt(0) ? offerDiscount.toFixed(2) : "0.00",
    freeDelivery: pc.freeDelivery ? { amount: pc.freeDelivery.amount.toFixed(2) } : null,
    coupon: pc.coupon && {
      code: pc.coupon.code, ok: pc.coupon.ok, savings: pc.couponSavings.toFixed(2),
      error: pc.coupon.error ? { code: pc.coupon.error.code, message: pc.coupon.error.message, details: pc.coupon.error.details ?? null } : null,
    },
  };
}

/**
 * FIRINGI cart: the customer sees FIRINGI as the seller. The delivery preview runs FIRINGI's
 * supplier choice for the default delivery address (checkout runs it again for the chosen one).
 */
async function routedCartView(
  ctx: Ctx, cart: { items: { offerId: string; qty: number }[]; couponCode?: string | null },
  lines: (Awaited<ReturnType<typeof pricedOffers>>["items"][number] & { lineNet: string; lineVat: string; lineGross: string })[],
  ro: RoutedOffers, goodsNet: Decimal, goodsVat: Decimal, offerDiscount: Decimal, addresses: Awaited<ReturnType<typeof prisma.address.findMany>>,
) {
  const unavailable = ro.unavailable;
  let free: { amount: string } | null = null;
  let couponSavings = ro.coupon?.ok ? ro.redemptions.filter((r) => r.code === ro.coupon!.code).reduce((a, r) => a.plus(r.amount), new Decimal(0)) : new Decimal(0);
  type D = { ok: true; mode: "VENDOR_FLEET" | "FIRINGI_FLEET" | "CARRIER"; feeNet: string; feeVat: string; feeVatRate: string; suppliers: number }
    | { ok: false; reason: "BELOW_MINIMUM" | "BELOW_SUPPLIER_MINIMUM" | "NOT_AVAILABLE_HERE"; minimum: string; missing: string; vendorMinimum: string | null };
  let delivery: D | null = null;
  let feeNet = new Decimal(0), feeVat = new Decimal(0);
  if (lines.length && addresses[0] && !unavailable.length) {
    const plan = await planRouted(ctx, cart.items, addresses[0].id, cart.couponCode ?? null);
    if (plan.waived.gt(0)) {
      free = { amount: plan.waived.toFixed(2) };
      if (ro.freeDelivery?.coupon) couponSavings = couponSavings.plus(plan.waived);
    }
    if (plan.leftover.length) delivery = { ok: false, reason: "NOT_AVAILABLE_HERE", minimum: "0", missing: "0", vendorMinimum: null };
    else if (goodsNet.lt(plan.minimum)) delivery = { ok: false, reason: "BELOW_MINIMUM", minimum: plan.minimum.toFixed(2), missing: new Decimal(plan.minimum).minus(goodsNet).toFixed(2), vendorMinimum: null };
    else {
      feeNet = plan.feeNet;
      let rate = new Decimal(0);
      if (feeNet.gt(0) && plan.feeTaxCategoryId) {
        const r = await prisma.taxRate.findFirst({ where: { countryId: ctx.company.countryId, regionId: null, taxCategoryId: plan.feeTaxCategoryId }, orderBy: { validFrom: "desc" } });
        rate = new Decimal(r?.rate.toString() ?? 0);
        feeVat = feeNet.mul(rate).div(100).toDecimalPlaces(2);
      }
      delivery = { ok: true, mode: plan.byFiringi ? "FIRINGI_FLEET" : "VENDOR_FLEET", feeNet: feeNet.toFixed(2), feeVat: feeVat.toFixed(2), feeVatRate: rate.toString(), suppliers: plan.picks.length };
    }
  }
  const credit = lines.length ? await creditBlock(ctx.company.id, goodsNet.plus(feeNet).plus(goodsVat).plus(feeVat)) : null;
  return {
    credit,
    routed: true,
    seller: { id: "", name: "FIRINGI" },
    lines, unavailable,
    taxLabel: lines[0]?.taxLabel ?? "VAT",
    goodsNet: goodsNet.toFixed(2),
    goodsVat: goodsVat.toFixed(2),
    delivery,
    totalNet: goodsNet.plus(feeNet).toFixed(2),
    totalVat: goodsVat.plus(feeVat).toFixed(2),
    totalGross: goodsNet.plus(feeNet).plus(goodsVat).plus(feeVat).toFixed(2),
    addresses,
    offerDiscount: offerDiscount.gt(0) ? offerDiscount.toFixed(2) : "0.00",
    freeDelivery: free,
    coupon: ro.coupon && {
      code: ro.coupon.code, ok: ro.coupon.ok, savings: couponSavings.toFixed(2),
      error: ro.coupon.error ? { code: ro.coupon.error.code, message: ro.coupon.error.message, details: ro.coupon.error.details ?? null } : null,
    },
  };
}
