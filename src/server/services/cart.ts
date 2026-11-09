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
import { decideDelivery } from "@/server/orders/delivery-rule";

function requireBuyer(ctx: Ctx) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "buyer.orders.place"))
    throw new ForbiddenError();
}

async function cartRow(ctx: Ctx) {
  return prisma.cart.upsert({
    where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } },
    update: {},
    create: { buyerCompanyId: ctx.company.id, userId: ctx.user.id },
    include: { items: true, seller: { select: { id: true, legalName: true, tradeName: true } } },
  });
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
  if (cart.sellerCompanyId && cart.sellerCompanyId !== item.vendor.id) {
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

export async function cartCount(ctx: Ctx) {
  if (!can(ctx, "buyer.orders.place") || ctx.company.status !== "APPROVED") return 0;
  return prisma.cartItem.count({ where: { cart: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } } });
}

/**
 * The rules that decide delivery for an order from `vendorCompanyId` to a buyer in
 * `buyerCountryId`: FIRINGI's rule for that country (admin minimum + fee) and the
 * vendor's own delivery minimum. (Zone / area-specific rules are added in Phase 6.)
 */
export async function deliveryRulesFor(buyerCountryId: string, vendorCompanyId: string) {
  const now = new Date();
  const valid = { isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
  const [firingi, vendor] = await Promise.all([
    prisma.deliveryRule.findFirst({ where: { ...valid, scope: "COUNTRY", countryId: buyerCountryId }, orderBy: [{ priority: "desc" }, { validFrom: "desc" }] }),
    prisma.deliveryRule.findFirst({ where: { ...valid, scope: "VENDOR", vendorCompanyId }, orderBy: [{ priority: "desc" }, { validFrom: "desc" }] }),
  ]);
  return { firingi, vendor };
}

/** Full cart view: priced lines, totals (incl. VAT), delivery decision. */
export async function cartView(ctx: Ctx) {
  requireBuyer(ctx);
  const cart = await cartRow(ctx);
  const { items, unavailable } = await pricedOffers(ctx, cart.items.map((i) => ({ offerId: i.offerId, qty: i.qty })));
  const lines = items.map((i) => {
    const c = computeLine({ qty: i.qty, unitListPriceNet: i.price?.unitPriceNet ?? 0, vatRatePercent: i.vatRate, commissionRatePercent: 0 });
    return { ...i, lineNet: c.lineNet.toFixed(2), lineVat: c.lineVat.toFixed(2), lineGross: c.lineNet.plus(c.lineVat).toFixed(2) };
  });
  const goodsNet = lines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
  const goodsVat = lines.reduce((a, l) => a.plus(l.lineVat), new Decimal(0));
  const seller = cart.seller;
  let delivery: ReturnType<typeof decideDelivery> | null = null;
  let feeVat = new Decimal(0);
  let feeVatRate = new Decimal(0);
  if (seller && lines.length) {
    const sellerCountry = (await prisma.company.findUniqueOrThrow({ where: { id: seller.id }, select: { countryId: true } })).countryId;
    const rules = await deliveryRulesFor(ctx.company.countryId, seller.id);
    delivery = decideDelivery(
      goodsNet,
      rules.firingi && { id: rules.firingi.id, minOrderValue: rules.firingi.minOrderValue!.toString(), feeNet: rules.firingi.firingiDeliveryFeeNet!.toString() },
      rules.vendor && { id: rules.vendor.id, amount: rules.vendor.vendorDeliveryMinimum!.toString() },
      sellerCountry !== ctx.company.countryId,
    );
    if (delivery.ok && delivery.feeNet.gt(0) && rules.firingi?.feeTaxCategoryId) {
      const r = await prisma.taxRate.findFirst({ where: { countryId: ctx.company.countryId, regionId: null, taxCategoryId: rules.firingi.feeTaxCategoryId }, orderBy: { validFrom: "desc" } });
      feeVatRate = new Decimal(r?.rate.toString() ?? 0);
      feeVat = delivery.feeNet.mul(feeVatRate).div(100).toDecimalPlaces(2);
    }
  }
  const feeNet = delivery?.ok ? delivery.feeNet : new Decimal(0);
  const addresses = await prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true, kind: "DELIVERY" }, orderBy: [{ isDefault: "desc" }, { label: "asc" }] });
  return {
    seller: seller && { id: seller.id, name: seller.tradeName ?? seller.legalName },
    lines,
    unavailable,
    taxLabel: lines[0]?.taxLabel ?? "VAT",
    goodsNet: goodsNet.toFixed(2),
    goodsVat: goodsVat.toFixed(2),
    delivery: delivery && (delivery.ok
      ? { ok: true as const, mode: delivery.mode, feeNet: feeNet.toFixed(2), feeVat: feeVat.toFixed(2), feeVatRate: feeVatRate.toString() }
      : { ok: false as const, reason: delivery.reason, minimum: delivery.minimum.toFixed(2), missing: delivery.missing.toFixed(2), vendorMinimum: delivery.vendorMinimum?.toFixed(2) ?? null }),
    totalNet: goodsNet.plus(feeNet).toFixed(2),
    totalVat: goodsVat.plus(feeVat).toFixed(2),
    totalGross: goodsNet.plus(feeNet).plus(goodsVat).plus(feeVat).toFixed(2),
    addresses,
  };
}
