/**
 * Coupons and customer offers at checkout (server side).
 *
 *  • Buyer context — customer groups, CRM segments, first order: decides which targeted
 *    offers apply ("customer offers").
 *  • Coupon — validated when entered and again at checkout: active, in the buyer's country,
 *    for this buyer (audience, first order), within its limits / budget, minimum order,
 *    and payable by the supplier of the cart (a vendor coupon only on its own goods; a
 *    FIRINGI coupon co-funded by suppliers only where the supplier accepted). Carts that
 *    FIRINGI routes to suppliers ("order from FIRINGI") accept FIRINGI-paid coupons only.
 *  • Order promotions — € off the order and free delivery, over the priced lines.
 *  • Redemptions — every promotion used on an order (limits, budgets, analytics).
 */
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { applyOrderPromotions, applyPromotions, LINE_KINDS, type OrderPromo } from "@/server/catalogue/promotions";
import { activityRows, matchesSegment, normaliseRules } from "@/server/services/crm-insights";
import { candidateOf, loadActivePromotions, normaliseCode, promoForBuyer, promoMatchesOffer, usage, type ActivePromotions, type BuyerPromoContext } from "@/server/services/promotions";

type Tx = Prisma.TransactionClient;
type Promo = ActivePromotions[number];

/** The buyer's groups, CRM segments (only those used by these promotions) and first-order status. */
export async function buyerPromoContext(companyId: string, promos: ActivePromotions, couponId?: string | null): Promise<BuyerPromoContext> {
  const segmentIds = [...new Set(promos.flatMap((p) => p.targets.map((t) => t.crmSegmentId).filter((x): x is string => !!x)))];
  const [groups, orders, segments, row] = await Promise.all([
    prisma.customerGroupMember.findMany({ where: { companyId }, select: { groupId: true } }),
    prisma.order.count({ where: { buyerCompanyId: companyId, status: { not: "CANCELLED" } } }),
    segmentIds.length ? prisma.crmSegment.findMany({ where: { id: { in: segmentIds } } }) : Promise.resolve([]),
    segmentIds.length ? activityRows({ id: companyId }).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  return {
    companyId, groupIds: groups.map((g) => g.groupId), firstOrder: orders === 0, couponId: couponId ?? null,
    segmentIds: row ? segments.filter((s) => matchesSegment(row, normaliseRules(s.rules))).map((s) => s.id) : [],
  };
}

const err = (code: string, message: string, details?: Record<string, string>) => new AppError(code, message, 422, details);

/** Look up and check a coupon for this buyer (everything that doesn't depend on the cart's goods). */
export async function findCoupon(ctx: Ctx, rawCode: string, cart: { sellerId: string | null; routed: boolean }) {
  const code = normaliseCode(rawCode);
  if (!code) throw err("COUPON_UNKNOWN", "This coupon code doesn't exist or has expired.");
  const promos = await loadActivePromotions(ctx.company.countryId);
  const p = promos.find((x) => x.code === code);
  if (!p) {
    const exists = await prisma.promotion.findUnique({ where: { code }, select: { maxRedemptions: true, budget: true, status: true, validFrom: true, validTo: true } });
    const live = exists && exists.status === "ACTIVE" && exists.validFrom <= new Date() && (!exists.validTo || exists.validTo > new Date());
    if (live && (exists.maxRedemptions != null || exists.budget != null)) throw err("COUPON_USED_UP", "This coupon has been fully used.");
    throw err("COUPON_UNKNOWN", "This coupon code doesn't exist or has expired.");
  }
  const buyer = await buyerPromoContext(ctx.company.id, promos, p.id);
  if (p.firstOrderOnly && !buyer.firstOrder) throw err("COUPON_FIRST_ORDER", "This coupon is only for a first order.");
  if (!promoForBuyer(p, buyer)) throw err("COUPON_NOT_FOR_YOU", "This coupon isn't available for your account.");
  if (p.maxPerCustomer != null && ((await usage([p.id], ctx.company.id)).get(p.id)?.count ?? 0) >= p.maxPerCustomer)
    throw err("COUPON_LIMIT_REACHED", "You have already used this coupon.");
  const firingiPays = p.ownerType === "ADMIN" && new Decimal(p.firingiFundPct.toString()).eq(100);
  if (cart.routed && !firingiPays) throw err("COUPON_OTHER_SUPPLIER", "This coupon can't be used on this order.");
  if (!cart.routed && cart.sellerId) {
    if (p.ownerType === "VENDOR" && p.ownerCompanyId !== cart.sellerId) throw err("COUPON_OTHER_SUPPLIER", "This coupon can't be used on this order.");
    if (p.ownerType === "ADMIN" && !firingiPays && !p.acceptances.some((a) => a.vendorCompanyId === cart.sellerId)) throw err("COUPON_OTHER_SUPPLIER", "This coupon can't be used on this order.");
  }
  return { promo: p, promos, buyer };
}

export type PricedLine = {
  key: string; offerId: string; vendorCompanyId: string; productId: string; categoryIds: string[]; qty: number;
  /** After line promotions. */
  unitSaleNet: Decimal.Value; lineNet: Decimal.Value;
};

/** € off the order and free delivery for these lines (automatic offers + the coupon). */
export function orderPromotionsFor(promos: ActivePromotions, buyer: BuyerPromoContext, lines: PricedLine[]) {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const cands: OrderPromo[] = promos
    .filter((p) => !LINE_KINDS.includes(p.kind) && promoForBuyer(p, buyer))
    .map((p) => {
      const matches = (key: string) => { const l = byKey.get(key); return !!l && promoMatchesOffer(p, { id: l.offerId, vendorCompanyId: l.vendorCompanyId, productId: l.productId, categoryIds: l.categoryIds }); };
      return { ...candidateOf(p), minOrderValue: p.minOrderValue?.toString() ?? null, matches };
    })
    .filter((c) => lines.some((l) => c.matches(l.key)));
  return applyOrderPromotions(lines.map((l) => ({ key: l.key, qty: l.qty, lineNet: l.lineNet, unitSaleNet: l.unitSaleNet })), cands);
}

/** Cart-time check of the coupon against the goods: minimum order and whether it does anything. */
export function couponEffect(coupon: Promo, lines: PricedLine[], applied: { lineCoupon: Decimal; orderCoupon: Decimal; freeDelivery: boolean }) {
  const goods = lines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
  if (coupon.minOrderValue && goods.lt(coupon.minOrderValue.toString()))
    return { ok: false as const, code: "COUPON_MIN_ORDER", minimum: new Decimal(coupon.minOrderValue.toString()), missing: new Decimal(coupon.minOrderValue.toString()).minus(goods) };
  const matches = lines.some((l) => promoMatchesOffer(coupon, { id: l.offerId, vendorCompanyId: l.vendorCompanyId, productId: l.productId, categoryIds: l.categoryIds }));
  if (!matches) return { ok: false as const, code: "COUPON_NOT_APPLICABLE" };
  const amount = applied.lineCoupon.plus(applied.orderCoupon);
  if (amount.lte(0) && !applied.freeDelivery) return { ok: false as const, code: coupon.kind === "BUY_X_GET_Y" || coupon.minQty ? "COUPON_QTY" : "COUPON_NOT_APPLICABLE" };
  return { ok: true as const, amount };
}

export function couponError(e: { code: string; minimum?: Decimal; missing?: Decimal }) {
  if (e.code === "COUPON_MIN_ORDER")
    return err("COUPON_MIN_ORDER", `Add ${e.missing!.toFixed(2)} € more to use this coupon (minimum ${e.minimum!.toFixed(2)} € excl. VAT).`, { minimum: e.minimum!.toFixed(2), missing: e.missing!.toFixed(2) });
  if (e.code === "COUPON_QTY") return err("COUPON_QTY", "Add more of the products this coupon is for to get the discount.");
  return err("COUPON_NOT_APPLICABLE", "This coupon doesn't apply to the products in your cart.");
}

/** Line promotions (automatic + coupon) as in the catalogue — used to re-check what the coupon gives. */
export function linePromoTotal(listUnitNet: Decimal.Value, qty: number, promos: ActivePromotions, buyer: BuyerPromoContext, offer: { id: string; vendorCompanyId: string; productId: string; categoryIds: string[] }) {
  const cands = promos.filter((p) => LINE_KINDS.includes(p.kind) && promoForBuyer(p, buyer) && promoMatchesOffer(p, offer)).map(candidateOf);
  return applyPromotions(listUnitNet, qty, cands);
}

export type RedemptionIn = { promotionId: string; code?: string | null; amount: Decimal; firingiAmount: Decimal; vendorAmount: Decimal };

/** Add up the promotions used on an order (one row per promotion) and record them. */
export async function recordRedemptions(tx: Tx, orderId: string, buyerCompanyId: string, entries: RedemptionIn[]) {
  const by = new Map<string, RedemptionIn>();
  for (const e of entries) {
    const cur = by.get(e.promotionId);
    by.set(e.promotionId, cur ? { ...cur, amount: cur.amount.plus(e.amount), firingiAmount: cur.firingiAmount.plus(e.firingiAmount), vendorAmount: cur.vendorAmount.plus(e.vendorAmount) } : e);
  }
  for (const e of by.values()) {
    const amount = e.firingiAmount.toDecimalPlaces(2).plus(e.vendorAmount.toDecimalPlaces(2));
    await tx.promotionRedemption.create({
      data: { promotionId: e.promotionId, orderId, buyerCompanyId, code: e.code ?? null, amount: amount.toFixed(2), firingiAmount: e.firingiAmount.toFixed(2), vendorAmount: e.vendorAmount.toFixed(2) },
    });
  }
}

/** After a supplier confirms fewer units: line-based redemption amounts follow the order lines. */
export async function syncRedemptions(tx: Tx, orderId: string) {
  const rows = await tx.promotionRedemption.findMany({ where: { orderId } });
  if (!rows.length) return;
  const sums = await tx.orderLineDiscount.groupBy({ by: ["promotionId"], where: { orderLine: { orderId } }, _sum: { firingiAmount: true, vendorAmount: true } });
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { deliveryPromotionId: true } });
  for (const r of rows) {
    if (r.promotionId === order.deliveryPromotionId) continue; // free delivery: fixed amount
    const s = sums.find((x) => x.promotionId === r.promotionId);
    if (!s) continue;
    const f = new Decimal(s._sum.firingiAmount?.toString() ?? 0), v = new Decimal(s._sum.vendorAmount?.toString() ?? 0);
    await tx.promotionRedemption.update({ where: { id: r.id }, data: { firingiAmount: f.toFixed(2), vendorAmount: v.toFixed(2), amount: f.plus(v).toFixed(2) } });
  }
}

/**
 * Inside the order transaction, after recording the redemption: lock the coupon and re-count
 * (orders placed at the same moment can't both take the last use). A budget stops an offer once
 * reached; the order that crosses it still gets its discount.
 */
export async function assertCouponLimits(tx: Tx, code: string, buyerCompanyId: string) {
  const [p] = await tx.$queryRaw<{ id: string; maxRedemptions: number | null; maxPerCustomer: number | null }[]>`
    SELECT id, "maxRedemptions", "maxPerCustomer" FROM "Promotion" WHERE code = ${code} FOR UPDATE`;
  if (!p) return;
  const live = { promotionId: p.id, order: { status: { not: "CANCELLED" as const } } };
  const [all, mine] = await Promise.all([
    tx.promotionRedemption.aggregate({ where: live, _count: { _all: true } }),
    p.maxPerCustomer != null ? tx.promotionRedemption.count({ where: { ...live, buyerCompanyId } }) : Promise.resolve(0),
  ]);
  if (p.maxRedemptions != null && all._count._all > p.maxRedemptions) throw err("COUPON_USED_UP", "This coupon has been fully used.");
  if (p.maxPerCustomer != null && mine > p.maxPerCustomer) throw err("COUPON_LIMIT_REACHED", "You have already used this coupon.");
}
