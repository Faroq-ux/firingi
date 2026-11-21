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
import { priceCheckout } from "@/server/orders/pricing";
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
  const existing = cart.items.find((i) => i.offerId === offerId);
  const total = (existing?.qty ?? 0) + qty;
  const err = checkQty(total, item.minOrderQty, item.qtyStep);
  if (err) throw new ValidationError(`${QTY_MESSAGES[err]} (min ${item.minOrderQty}, step ${item.qtyStep})`);
  await (await import("@/server/excise/service")).assertItems(ctx.company.id, [{ offerId, qty: total }]); // Phase 43: licence, country, cap
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
  await (await import("@/server/excise/service")).assertItems(ctx.company.id, [{ offerId, qty }]); // Phase 43
  await prisma.cartItem.update({ where: { id: line.id }, data: { qty } });
}

export async function removeFromCart(ctx: Ctx, offerId: string) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, offerId } }); // trigger unlocks when empty
}

/** Phase 32: how many loyalty points to spend on this cart (0 = none). Checked again at checkout. */
export async function setCartPoints(ctx: Ctx, points: number) {
  requireBuyer(ctx);
  if (!Number.isInteger(points) || points < 0 || points > 10_000_000) throw new ValidationError("Points: a whole number.");
  const cart = await cartRow(ctx);
  if (points > 0) {
    if (cart.routed) throw new AppError("LOYALTY_ROUTED", "Points can't be used when FIRINGI chooses the supplier — use them as a credit note instead.", 409);
    const { buyerPerks } = await import("@/server/loyalty/service");
    const p = await buyerPerks(ctx.company.id);
    if (!p) throw new AppError("LOYALTY_OFF", "Rewards aren't available for your company.", 403);
    if (points < p.settings.minRedeem) throw new ValidationError(`Use at least ${p.settings.minRedeem} points.`);
    if (points > p.balance) throw new AppError("NOT_ENOUGH_POINTS", `You have ${p.balance} points.`, 409);
  }
  await prisma.cart.update({ where: { id: cart.id }, data: { loyaltyPoints: points } });
  return { points };
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
  const sellerIds = [...new Set((await prisma.vendorOffer.findMany({ where: { id: { in: cart.items.map((i) => i.offerId) } }, select: { vendorCompanyId: true } })).map((o) => o.vendorCompanyId))];
  const { promo } = await findCoupon(ctx, code, { sellerIds, routed: cart.routed });
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
  const { orderableAddressWhere } = await import("@/server/multisite/branches");
  const addresses = await prisma.address.findMany({ where: await orderableAddressWhere(ctx), orderBy: [{ isDefault: "desc" }, { label: "asc" }], include: { city: { select: { regionId: true } }, branch: { select: { name: true } } } });
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
  const empty = { credit: null, routed: false as const, groups: [], lines: [], unavailable: [], taxLabel: "VAT", goodsNet: "0.00", goodsVat: "0.00", delivery: null, totalNet: "0.00", totalVat: "0.00", totalGross: "0.00", addresses, coupon: null, offerDiscount: "0.00", freeDelivery: null, loyalty: null };
  if (!cart.items.length) return empty;
  const pc = await priceCheckout(ctx, { items: cart.items.map((i) => ({ offerId: i.offerId, qty: i.qty })), couponCode: cart.couponCode }, { regionId: addresses[0]?.city?.regionId ?? null, addressId: addresses[0]?.id ?? null, loyaltyPoints: cart.loyaltyPoints });
  const { LOYALTY_PROMOTION_ID } = await import("@/server/loyalty/service");
  // the points discount on the goods (not the tier's free delivery) — shown apart from offers
  const loyaltyOff = (part: (typeof pc.parts)[number]) => part.lines.reduce((a, l) => a.plus(l.discounts.filter((d) => d.promotionId === LOYALTY_PROMOTION_ID).reduce((x, d) => x.plus(d.perUnit.mul(l.item.qty)), new Decimal(0))), new Decimal(0)).toDecimalPlaces(2);
  const sellers = await prisma.company.findMany({ where: { id: { in: pc.parts.map((p) => p.sellerId) } }, select: { id: true, legalName: true, tradeName: true } });
  // One group per supplier (= one order). Lines at their price after product offers (incl. a product
  // coupon); € off the order is shown apart.
  const groups = pc.parts.map((part) => {
    const lines = part.lines.map((l) => {
      const c = computeLine({ qty: l.item.qty, unitListPriceNet: l.item.price!.unitPriceNet, vatRatePercent: l.rate, commissionRatePercent: 0 });
      return { ...l.item, lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2), lineGross: c.lineNet.plus(c.lineVat).toFixed(2) };
    });
    const shown = lines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
    const d = part.decision;
    const s0 = sellers.find((x) => x.id === part.sellerId)!;
    return {
      supplier: { id: part.sellerId, name: s0.tradeName ?? s0.legalName },
      lines, goodsNet: part.totals.goodsNet.toFixed(2), shownNet: shown.toFixed(2), offerDiscount: shown.minus(part.totals.goodsNet).minus(loyaltyOff(part)).toFixed(2),
      delivery: d.ok
        ? { ok: true as const, mode: d.mode, feeNet: part.chargedFee.toFixed(2), feeVat: part.totals.deliveryFeeVat.toFixed(2), feeVatRate: part.feeVatRate.toString(), free: part.freeDelivery ? ("OFFER" as const) : d.free }
        : { ok: false as const, reason: d.reason as "BELOW_MINIMUM" | "BELOW_SUPPLIER_MINIMUM" | "NOT_AVAILABLE_HERE" | "SMALL_ORDER_LIMIT", minimum: d.unit === "UNITS" ? String(d.minimum) : d.minimum.toFixed(2), missing: d.unit === "UNITS" ? String(d.missing) : d.missing.toFixed(2), unit: d.unit, vendorMinimum: d.vendorMinimum?.toFixed(2) ?? null },
      freeDelivery: part.freeDelivery ? { amount: part.freeDelivery.amount.toFixed(2) } : null,
    };
  });
  const lines = groups.flatMap((g) => g.lines);
  const feeNet = pc.parts.reduce((a, p) => a.plus(p.chargedFee), new Decimal(0));
  const feeVat = pc.parts.reduce((a, p) => a.plus(p.totals.deliveryFeeVat), new Decimal(0));
  const offerDiscount = groups.reduce((a, g) => a.plus(g.offerDiscount), new Decimal(0));
  const waived = groups.reduce((a, g) => a.plus(g.freeDelivery?.amount ?? 0), new Decimal(0));
  const firstBad = groups.find((g) => !g.delivery.ok)?.delivery;
  const credit = await creditBlock(ctx.company.id, pc.grandTotal);
  // Phase 45: the cart in the customer's currency, worked out like the order will be (a fixed local price exactly)
  const { viewerFx } = await import("@/server/currency/service");
  const { localAmounts, roundMoney, toLocal } = await import("@/lib/currency");
  const fx = await viewerFx(ctx, "BUYER");
  let local: { code: string; net: string; vat: string; gross: string; shownNet: string; fee: string; lines: Record<string, { net: string; gross: string }> } | null = null;
  if (fx.code !== "EUR") {
    const all = pc.parts.flatMap((p) => p.lines);
    const r = localAmounts(all.map((l) => {
      const f = l.item.price?.fixedLocal;
      const listEur = new Decimal(l.calc.unitListPriceNet.toString());
      return { lineNet: l.calc.lineNet, lineVat: l.calc.lineVat, taxRate: l.rate, unitSaleEur: l.calc.unitSalePriceNet, unitLocal: f && f.code === fx.code && !listEur.isZero() ? new Decimal(l.calc.unitSalePriceNet.toString()).mul(f.unitNet).div(listEur).toDecimalPlaces(4) : null };
    }), { net: pc.netTotal, vat: pc.vatTotal, grand: pc.grandTotal }, fx.rate, fx.code);
    const shownLines = Object.fromEntries(lines.map((l) => {
      const unit = new Decimal(l.price?.local?.unitPriceNet ?? 0);
      const net = roundMoney(unit.mul(l.qty), fx.code);
      return [l.offerId, { net: net.toString(), gross: roundMoney(net.mul(new Decimal(l.vatRate).div(100).plus(1)), fx.code).toString() }];
    }));
    const shownNet = Object.values(shownLines).reduce((a, x) => a.plus(x.net), new Decimal(0));
    local = { code: fx.code, net: r.net.toString(), vat: r.vat.toString(), gross: r.grand.toString(), shownNet: shownNet.toString(), fee: toLocal(feeNet, fx.rate, fx.code).toString(), lines: shownLines };
  }
  return {
    local,
    credit,
    routed: false as const,
    groups,
    lines,
    unavailable: pc.unavailable,
    taxLabel: lines[0]?.taxLabel ?? "VAT",
    goodsNet: pc.goodsNet.toFixed(2),
    goodsVat: pc.vatTotal.minus(feeVat).toFixed(2),
    /** All suppliers: ok when every part can be delivered; else the first problem. */
    delivery: groups.length === 1 ? groups[0].delivery : firstBad ?? (groups.length ? { ok: true as const, mode: null, feeNet: feeNet.toFixed(2), feeVat: feeVat.toFixed(2), free: null } : null),
    totalNet: pc.netTotal.toFixed(2),
    totalVat: pc.vatTotal.toFixed(2),
    totalGross: pc.grandTotal.toFixed(2),
    addresses,
    offerDiscount: offerDiscount.gt(0) ? offerDiscount.toFixed(2) : "0.00",
    freeDelivery: waived.gt(0) ? { amount: waived.toFixed(2) } : null,
    coupon: pc.coupon && {
      code: pc.coupon.code, ok: pc.coupon.ok, savings: pc.couponSavings.toFixed(2),
      error: pc.coupon.error ? { code: pc.coupon.error.code, message: pc.coupon.error.message, details: pc.coupon.error.details ?? null } : null,
    },
    /** Phase 32: points the buyer chose to spend, what they take off (excl. VAT), the limits. */
    loyalty: pc.loyalty && {
      balance: pc.loyalty.balance, requested: pc.loyalty.requested, used: pc.loyalty.used, euros: pc.loyalty.euros.toFixed(2),
      max: Math.min(pc.loyalty.balance, pc.loyalty.maxPoints), reason: pc.loyalty.reason, freeDelivery: pc.loyalty.freeDelivery,
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
    | { ok: false; reason: "BELOW_MINIMUM" | "BELOW_SUPPLIER_MINIMUM" | "NOT_AVAILABLE_HERE" | "SMALL_ORDER_LIMIT"; minimum: string; missing: string; vendorMinimum: string | null };
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
    loyalty: null as null, // Phase 32: points can't be spent when FIRINGI chooses the supplier
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
    /** FIRINGI picks the supplier(s): one group shown as FIRINGI. */
    groups: lines.length ? [{ supplier: { id: "", name: "FIRINGI" }, lines, goodsNet: goodsNet.toFixed(2), shownNet: goodsNet.plus(offerDiscount).toFixed(2), offerDiscount: offerDiscount.toFixed(2), delivery, freeDelivery: free }] : [],
    offerDiscount: offerDiscount.gt(0) ? offerDiscount.toFixed(2) : "0.00",
    freeDelivery: free,
    coupon: ro.coupon && {
      code: ro.coupon.code, ok: ro.coupon.ok, savings: couponSavings.toFixed(2),
      error: ro.coupon.error ? { code: ro.coupon.error.code, message: ro.coupon.error.message, details: ro.coupon.error.details ?? null } : null,
    },
  };
}
