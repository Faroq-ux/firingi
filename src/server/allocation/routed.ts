/**
 * "Order from FIRINGI" (countries in FIRINGI ordering mode, customers only).
 * The customer sees one FIRINGI price per product and checks out one cart; FIRINGI picks
 * the wholesaler(s) — nearest or cheapest (rules), or its in-house warehouse — and creates
 * one order per supplier. The customer never pays more than the price shown.
 * Delivery: supplier delivers free when its goods reach its free-delivery minimum; otherwise
 * FIRINGI's fleet at FIRINGI's flat fee, charged once per checkout.
 */
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError, ValidationError } from "@/server/errors";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { loadActivePromotions } from "@/server/services/promotions";
import type { FreeDelivery } from "@/server/catalogue/promotions";
import { assertCouponLimits, buyerPromoContext, couponEffect, couponError, findCoupon, orderPromotionsFor, recordRedemptions, type PricedLine, type RedemptionIn } from "@/server/marketing/offers";
import { vatRate } from "@/server/services/orders";
import { deliveryRulesFor } from "@/server/services/cart";
import { writeAudit } from "@/server/services/audit";
import { assertCanOrder } from "@/server/services/payments";
import { notify } from "@/server/notify/dispatch";
import { allocationRules } from "./rules";
import { vendorMinimumReached } from "@/server/orders/delivery-rule";
import { createAllocatedOrder, findCandidates, planMoves, type Candidate, type MoveItem } from "./engine";

export { orderingMode } from "./mode";

type CartLine = { offerId: string; qty: number };

/**
 * Offers on a FIRINGI cart: the products' prices (automatic offers and a product coupon), then
 * € off the order and free delivery — FIRINGI-paid only, since FIRINGI picks the suppliers.
 * Everything is FIRINGI's: it lowers the price the buyer pays, which is the ceiling for sourcing.
 */
export async function routedOffers(ctx: Ctx, lines: CartLine[], couponCode: string | null, skipCoupon = false): Promise<RoutedOffers> {
  let coupon: Awaited<ReturnType<typeof findCoupon>> | null = null;
  let couponErr: AppError | null = null;
  if (couponCode && !skipCoupon) {
    try { coupon = await findCoupon(ctx, couponCode, { sellerIds: [], routed: true }); } catch (e) { if (e instanceof AppError) couponErr = e; else throw e; }
  }
  const promos = coupon?.promos ?? (await loadActivePromotions(ctx.company.countryId));
  const buyer = coupon?.buyer ?? (await buyerPromoContext(ctx.company.id, promos, null));
  const { items, unavailable } = await pricedOffers(ctx, lines, { couponId: coupon?.promo.id ?? null });
  const priced = items.filter((i) => i.price);
  const plines: PricedLine[] = priced.map((i) => ({
    key: i.offerId, offerId: i.offerId, vendorCompanyId: i.vendorCompanyId, productId: i.productId, categoryIds: i.categoryIds, qty: i.qty,
    unitSaleNet: i.price!.unitPriceNet, lineNet: new Decimal(i.price!.unitPriceNet).mul(i.qty).toDecimalPlaces(2),
  }));
  const firingiPaid = promos.filter((p) => p.ownerType === "ADMIN" && new Decimal(p.firingiFundPct.toString()).eq(100));
  const order = orderPromotionsFor(firingiPaid, buyer, plines);
  const extra = new Map<string, Decimal>();
  for (const d of order.discounts) for (const [k, v] of d.perLine) extra.set(k, (extra.get(k) ?? new Decimal(0)).plus(v.perUnit));
  const redemptions: RedemptionIn[] = [];
  for (const i of priced)
    for (const p of i.price!.promotions.filter((x) => x.coupon)) {
      const a = new Decimal(p.perUnit).mul(i.qty).toDecimalPlaces(2);
      redemptions.push({ promotionId: p.id, code: coupon?.promo.code, amount: a, firingiAmount: a, vendorAmount: new Decimal(0) });
    }
  for (const d of order.discounts) redemptions.push({ promotionId: d.promotionId, code: d.coupon ? coupon?.promo.code : null, amount: d.total, firingiAmount: d.total, vendorAmount: new Decimal(0) });
  if (coupon) {
    const lineCoupon = redemptions.filter((r) => r.promotionId === coupon!.promo.id && !order.discounts.some((d) => d.promotionId === r.promotionId)).reduce((a, r) => a.plus(r.amount), new Decimal(0));
    const effect = couponEffect(coupon.promo, plines, { lineCoupon, orderCoupon: order.discounts.find((d) => d.coupon)?.total ?? new Decimal(0), freeDelivery: !!order.freeDelivery?.coupon });
    if (!effect.ok) return { ...(await routedOffers(ctx, lines, couponCode, true)), coupon: { code: coupon.promo.code!, ok: false, error: couponError(effect) } };
  }
  return {
    items, unavailable, extra, freeDelivery: order.freeDelivery, redemptions,
    coupon: couponCode ? (couponErr ? { code: couponCode, ok: false, error: couponErr } : coupon ? { code: coupon.promo.code!, ok: true, error: null } : null) : null,
  };
}
export type RoutedOffers = {
  items: Awaited<ReturnType<typeof pricedOffers>>["items"]; unavailable: string[];
  /** € off the order, per unit, by offer. */
  extra: Map<string, Decimal>;
  freeDelivery: FreeDelivery | null;
  redemptions: RedemptionIn[];
  coupon: { code: string; ok: boolean; error: AppError | null } | null;
};

/** Turn cart lines into items FIRINGI must source, with the price the buyer saw as the ceiling. */
async function itemsFor(ctx: Ctx, ro: RoutedOffers, regionId: string | null) {
  const { items, unavailable } = ro;
  if (unavailable.length || items.some((i) => !i.price)) throw new AppError("ITEM_UNAVAILABLE", "Some products in your cart are no longer available. Please review your cart.", 409);
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: items.map((i) => i.offerId) } }, select: { id: true, packagingUnitId: true } });
  const pu = new Map(offers.map((o) => [o.id, o.packagingUnitId]));
  const out: MoveItem[] = [];
  for (const i of items)
    out.push({
      lineId: i.offerId, offerId: i.offerId, packagingUnitId: pu.get(i.offerId)!, qty: i.qty, name: i.name, sku: i.sku,
      unitSalePriceNet: new Decimal(i.price!.unitPriceNet).minus(ro.extra.get(i.offerId) ?? 0).toFixed(4), taxRate: (await vatRate(prisma, ctx.company.countryId, regionId, i.taxCategoryId)).toString(),
    });
  return out;
}

export type RoutedPlan = Awaited<ReturnType<typeof planRouted>>;

/** Which supplier(s) would deliver this cart to this address, and the delivery fee. */
export async function planRouted(ctx: Ctx, lines: CartLine[], addressId: string, couponCode: string | null = null) {
  const address = await prisma.address.findFirst({ where: { id: addressId, companyId: ctx.company.id, isActive: true, kind: "DELIVERY", countryId: ctx.company.countryId }, include: { city: true } });
  if (!address) throw new ValidationError("Choose one of your delivery addresses.");
  const rules = await allocationRules();
  const offers = await routedOffers(ctx, lines, couponCode);
  const items = await itemsFor(ctx, offers, address.city?.regionId ?? null);
  const cands = await findCandidates(
    { id: null, buyerCompanyId: ctx.company.id, countryId: ctx.company.countryId, flow: "CUSTOMER_FROM_WHOLESALER", addressId, buyer: ctx },
    items, rules, new Set(),
  );
  const { picks, leftover } = planMoves(cands, items.length, rules.maxSplitOrders);
  const firingi = (await deliveryRulesFor(ctx.company.countryId, "", addressId)).firingi;
  const goodsNet = picks.reduce((a, p) => a + p.covers.reduce((s, c) => s + Number(c.lineNet), 0), 0);
  // FIRINGI's fleet (flat fee, once) for every part that isn't delivered free by its supplier.
  const byFiringi = picks.some((p) => p.candidate.inHouse || !freeFor(p.candidate, p.covers));
  // FIRINGI's free delivery (admin switch, per country / zone) on the whole checkout, else its flat rate.
  const firingiFree = !!firingi?.firingiFreeEnabled && firingi.firingiFreeFrom != null && goodsNet >= Number(firingi.firingiFreeFrom);
  const fullFee = byFiringi && firingi && !firingiFree ? new Decimal(firingi.firingiDeliveryFeeNet?.toString() ?? 0) : new Decimal(0);
  // A FIRINGI-paid free-delivery offer waives it.
  const waived = offers.freeDelivery && fullFee.gt(0) ? fullFee : new Decimal(0);
  const feeNet = fullFee.minus(waived);
  const minimum = firingi?.minOrderValue ? Number(firingi.minOrderValue) : 0;
  const redemptions = [...offers.redemptions];
  if (waived.gt(0)) redemptions.push({ promotionId: offers.freeDelivery!.promotionId, code: offers.freeDelivery!.coupon ? offers.coupon?.code : null, amount: waived, firingiAmount: waived, vendorAmount: new Decimal(0) });
  return {
    address, items, candidates: cands, picks, leftover, goodsNet, feeNet, waived, minimum, byFiringi, feeRuleId: firingi?.id ?? null, feeTaxCategoryId: firingi?.feeTaxCategoryId ?? null,
    offers, redemptions, deliveryPromotionId: waived.gt(0) ? offers.freeDelivery!.promotionId : null,
  };
}

/** Does this pick reach the supplier's own free-delivery minimum? (In-house: FIRINGI's fleet.) */
function freeFor(c: Candidate, covers: { lineNet: string; qty: number }[]) {
  if (c.inHouse) return false;
  return vendorMinimumReached(c.deliveryRule, covers.reduce((a, x) => a + Number(x.lineNet), 0), covers.reduce((a, x) => a + x.qty, 0));
}

/** Check out a FIRINGI cart: one order per picked supplier. */
export async function placeRoutedOrder(ctx: Ctx, cart: { id: string; items: CartLine[]; couponCode?: string | null }, input: { deliveryAddressId: string; notes?: string | null; requestedDeliveryDate?: Date | null }) {
  const plan = await planRouted(ctx, cart.items, input.deliveryAddressId, cart.couponCode ?? null);
  if (plan.offers.coupon && !plan.offers.coupon.ok) throw plan.offers.coupon.error!;
  if (plan.leftover.length) {
    const names = plan.leftover.map((i) => plan.items[i].name.pt ?? plan.items[i].name.en).join(", ");
    throw new AppError("NOT_AVAILABLE_HERE", `These products can't be delivered to this address right now: ${names}. Remove them or try another address.`, 409);
  }
  if (plan.goodsNet < plan.minimum)
    throw new AppError("BELOW_MINIMUM", `Minimum order for delivery is ${plan.minimum.toFixed(2)} € (excl. VAT). Add ${(plan.minimum - plan.goodsNet).toFixed(2)} € more.`, 422);
  const a = plan.address;
  const base = {
    flow: "CUSTOMER_FROM_WHOLESALER" as const, buyerCompanyId: ctx.company.id, countryId: ctx.company.countryId, placedByUserId: ctx.user.id,
    deliveryAddress: {
      id: a.id, label: a.label, line1: a.line1, line2: a.line2, postalCode: a.postalCode, city: a.cityName, regionId: a.city?.regionId ?? null,
      country: ctx.company.countryCode, contactName: a.contactName, phone: a.phone, latitude: a.latitude?.toString() ?? null, longitude: a.longitude?.toString() ?? null,
    } as Prisma.JsonValue,
    requestedDeliveryDate: input.requestedDeliveryDate ?? null, buyerNotes: input.notes?.trim() || null, deliveryRuleId: plan.feeRuleId,
    parentOrderId: null, routedByFiringi: true,
  };
  // FIRINGI's risk checks on the whole checkout: HIGH → held for review before the suppliers see it.
  const { assessCheckout, recordRisk, afterCheckout } = await import("@/server/risk/service");
  // Gross as the customer saw it: items at their price with VAT, plus the delivery fee.
  const gross = plan.items.reduce((a, i) => a + Number(i.unitSalePriceNet) * i.qty * (1 + Number(i.taxRate) / 100), 0) + plan.feeNet.toNumber();
  const risk = await assessCheckout(ctx, { gross, goods: plan.goodsNet, addressId: input.deliveryAddressId, couponCode: plan.offers.coupon?.ok ? plan.offers.coupon.code : null });
  const checkoutId = randomUUID();
  // The flat fee goes on the first order FIRINGI's fleet delivers.
  const feeIdx = plan.picks.findIndex((p) => p.candidate.inHouse || !freeFor(p.candidate, p.covers));
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const [i, p] of plan.picks.entries())
      out.push(await createAllocatedOrder(tx, base, p.candidate.vendorId, plan.items, p.covers, i === feeIdx ? plan.feeNet : new Decimal(0), "Ordered from FIRINGI", ctx.user.id));
    // Offers: coupon on every order of the checkout; free delivery on the order that carries the fee; redemptions on the first.
    const coupon = plan.offers.coupon?.ok ? plan.offers.coupon.code : null;
    if (coupon) await tx.order.updateMany({ where: { id: { in: out.map((o) => o.orderId) } }, data: { couponCode: coupon } });
    if (plan.waived.gt(0)) await tx.order.update({ where: { id: out[Math.max(0, feeIdx)].orderId }, data: { deliveryDiscountNet: plan.waived.toFixed(2), deliveryPromotionId: plan.deliveryPromotionId } });
    await recordRedemptions(tx, out[0].orderId, ctx.company.id, plan.redemptions);
    if (coupon) await assertCouponLimits(tx, coupon, ctx.company.id);
    // Credit control on the whole checkout (rolls everything back when blocked).
    const gross = (await tx.order.findMany({ where: { id: { in: out.map((o) => o.orderId) } }, select: { grandTotal: true } })).reduce((a, o) => a.plus(o.grandTotal.toString()), new Decimal(0));
    await assertCanOrder(ctx.company.id, gross);
    await tx.order.updateMany({ where: { id: { in: out.map((o) => o.orderId) } }, data: { checkoutId } });
    if (await recordRisk(tx, risk, out.map((o) => ({ id: o.orderId, buyerCompanyId: ctx.company.id })), checkoutId))
      for (const o of out) {
        await tx.order.update({ where: { id: o.orderId }, data: { status: "ON_HOLD" } });
        await tx.orderStatusHistory.create({ data: { orderId: o.orderId, fromStatus: "PENDING_CONFIRMATION", toStatus: "ON_HOLD", reason: `Held for a check by FIRINGI (risk ${risk.score})` } });
      }
    for (const o of out) {
      const now = await tx.order.findUniqueOrThrow({ where: { id: o.orderId }, select: { status: true } });
      await (await import("@/server/integrations/webhooks")).emitOrderEvents(tx, o.orderId, { from: "NEW", to: now.status, placed: true });
    }
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order.placed", entityType: "Order", entityId: out[0].orderId, after: { routed: true, orders: out.map((o) => ({ number: o.number, vendorId: o.vendorId, mode: o.mode })) } }, tx);
    return out;
  });
  const buyer = ctx.company.tradeName ?? ctx.company.legalName;
  await afterCheckout(risk, created.map((c) => ({ id: c.orderId, number: c.number })), ctx.company.id, buyer);
  if (risk.level === "HIGH") return { id: created[0].orderId, number: created[0].number, orders: created.map((c) => ({ id: c.orderId, number: c.number })) };
  for (const c of created) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: c.orderId }, select: { grandTotal: true } });
    await notify("order.new", [{ companyId: c.vendorId, link: `/vendor/orders/${c.orderId}` }], { number: c.number, buyer, total: o.grandTotal.toNumber() }, { ref: { type: "Order", id: c.orderId } });
  }
  return { id: created[0].orderId, number: created[0].number, orders: created.map((c) => ({ id: c.orderId, number: c.number })) };
}

