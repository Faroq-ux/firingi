/**
 * Checkout pricing for a cart — the same numbers for the cart preview and for placing the
 * order(s). A cart may hold products from several suppliers: each supplier's part becomes its
 * own order with its own delivery (who delivers, minimum, fee).
 *
 *   1. lines at the buyer's price (list / contract price − vendor offer − FIRINGI offer − coupon)
 *   2. per supplier: the best automatic € off the order (that supplier's or FIRINGI's)
 *   3. the coupon's € off, spread over all the lines it applies to (whole checkout)
 *   4. per supplier: delivery on its goods after discounts; a free-delivery offer either has
 *      the supplier deliver free (supplier-paid) or waives the fee (FIRINGI-paid — FIRINGI still
 *      pays a supplier's flat rate)
 *   5. totals per supplier and for the checkout, and what each promotion gave (redemptions)
 *
 * A coupon that doesn't work for this cart (minimum order, nothing it applies to …) is reported
 * in `coupon.error` and the cart is priced without it; placing the order then fails.
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { applyOrderPromotions, type FreeDelivery, type OrderDiscount } from "@/server/catalogue/promotions";
import { computeLine, computeTotals } from "./calc";
import { decideDelivery, firingiInput, vendorInput } from "./delivery-rule";
import { deliveryRulesFor } from "@/server/services/cart";
import { vatRate } from "@/server/services/orders";
import { grossOf } from "@/server/catalogue/pricing";
import { candidateOf, loadActivePromotions, promoMatchesOffer } from "@/server/services/promotions";
import { buyerPromoContext, couponEffect, couponError, findCoupon, orderPromotionsFor, type PricedLine, type RedemptionIn } from "@/server/marketing/offers";

export type LineDiscount = { promotionId: string; ownerType: "VENDOR" | "ADMIN"; coupon: boolean; perUnit: Decimal; firingiPerUnit: Decimal; vendorPerUnit: Decimal };
/** Phase 38: the line is on a deal (price, commission) — or a deal is there but doesn't apply (why). */
export type DealHit = { dealId: string; bidId: string | null; kind: string; unit: number; commissionPct: number | null };
export type DealNote = { dealId: string; why: string; left?: number | null };
type Item = Awaited<ReturnType<typeof pricedOffers>>["items"][number] & { deal?: DealHit | null; dealNote?: DealNote | null };
type Line = { item: Item; rate: Decimal; discounts: LineDiscount[]; unitSale: Decimal };

export type SupplierPart = {
  sellerId: string;
  lines: { item: Item; rate: Decimal; discounts: LineDiscount[]; calc: ReturnType<typeof computeLine> & { qty: number }; deal: DealHit | null }[];
  goodsNet: Decimal;
  decision: ReturnType<typeof decideDelivery>;
  normalFee: Decimal; chargedFee: Decimal; waived: Decimal; feeVatRate: Decimal; feeRuleId: string | null;
  totals: ReturnType<typeof computeTotals>;
  redemptions: RedemptionIn[];
  deliveryPromotionId: string | null;
  freeDelivery: { funder: "FIRINGI" | "VENDOR"; amount: Decimal } | null;
};

export type PricedCheckout = {
  parts: SupplierPart[];
  unavailable: string[];
  /** Whole checkout. */
  goodsNet: Decimal; netTotal: Decimal; vatTotal: Decimal; grandTotal: Decimal;
  couponSavings: Decimal;
  coupon: { code: string; ok: boolean; error: AppError | null } | null;
  /** Phase 32: loyalty points spent on this checkout (FIRINGI pays) and the Gold free delivery. */
  loyalty: { requested: number; used: number; euros: Decimal; maxPoints: number; balance: number; freeDelivery: boolean; reason: "OFF" | "BELOW_MIN" | "NOT_ENOUGH" | "CAPPED" | null } | null;
};

type Opts = {
  regionId: string | null; addressId: string | null; commissionRates?: Map<string, Decimal.Value>; skipCoupon?: boolean;
  /** Agreed prices per offer (an accepted quote, Phase 26): the line costs exactly this — no promotions, no coupon. */
  fixedPrices?: Map<string, Decimal.Value>;
  /** Phase 32: loyalty points the buyer wants to spend (discount at checkout, FIRINGI-funded). */
  loyaltyPoints?: number;
};

export async function priceCheckout(ctx: Ctx, cart: { items: { offerId: string; qty: number }[]; couponCode: string | null }, opts: Opts): Promise<PricedCheckout> {
  // Which suppliers are in the cart (for the coupon's supplier check).
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: cart.items.map((i) => i.offerId) } }, select: { vendorCompanyId: true } });
  const sellerIds = [...new Set(offers.map((o) => o.vendorCompanyId))];

  // 1. coupon (buyer-level checks) — an invalid one is reported and ignored here
  let coupon: Awaited<ReturnType<typeof findCoupon>> | null = null;
  let couponErr: AppError | null = null;
  if (cart.couponCode && !opts.skipCoupon && !opts.fixedPrices) {
    try { coupon = await findCoupon(ctx, cart.couponCode, { sellerIds, routed: false }); } catch (e) { if (e instanceof AppError) couponErr = e; else throw e; }
  }
  const promos = coupon?.promos ?? (await loadActivePromotions(ctx.company.countryId));
  const buyer = coupon?.buyer ?? (await buyerPromoContext(ctx.company.id, promos, null));
  const noCoupon = { ...buyer, couponId: null };

  const { items: offered, unavailable } = await pricedOffers(ctx, cart.items, { couponId: coupon?.promo.id ?? null });
  const fixed = opts.fixedPrices;
  const itemsBase: Item[] = fixed
    ? offered.map((i) => {
        const v = fixed.get(i.offerId);
        if (v === undefined || !i.price) return i;
        const net = new Decimal(v);
        return { ...i, price: { ...i.price, listUnitNet: net.toFixed(4), unitPriceNet: net.toFixed(4), promotions: [], vendorFundedPerUnit: "0", firingiFundedPerUnit: "0", fixedLocal: null, local: null } };
      })
    : offered;
  // Phase 38: clearance deals — the deal price replaces promotions and coupons on that line (supplier-funded)
  let items: Item[] = itemsBase;
  if (!fixed) {
    const { dealPricing } = await import("@/server/deals/service");
    const hits = await dealPricing(ctx.company.id, itemsBase.filter((i) => i.price).map((i) => ({ offerId: i.offerId, qty: i.qty, listUnit: Number(i.price!.listUnitNet) })));
    items = itemsBase.map((i) => {
      const h = hits.get(i.offerId);
      if (!h || !i.price) return i;
      if ("why" in h) return { ...i, dealNote: { dealId: h.dealId, why: h.why, left: h.left ?? null } };
      const list = new Decimal(i.price.listUnitNet);
      const unit = new Decimal(h.unit);
      return { ...i, deal: { dealId: h.dealId, bidId: h.bidId, kind: h.kind, unit: h.unit, commissionPct: h.commissionPct }, price: { ...i.price, unitPriceNet: unit.toFixed(4), unitPriceGross: grossOf(unit, String(i.vatRate)).toFixed(2), promotions: [], vendorFundedPerUnit: list.minus(unit).toFixed(4), firingiFundedPerUnit: "0" } };
    });
  }
  const lines: Line[] = await Promise.all(items.filter((i) => i.price).map(async (i) => {
    const p = i.price!;
    return {
      item: i, rate: await vatRate(prisma, ctx.company.countryId, opts.regionId, i.taxCategoryId),
      discounts: p.promotions.map((x) => ({ promotionId: x.id, ownerType: x.ownerType, coupon: x.coupon, perUnit: new Decimal(x.perUnit), firingiPerUnit: new Decimal(x.firingiPerUnit), vendorPerUnit: new Decimal(x.vendorPerUnit) })),
      unitSale: new Decimal(p.listUnitNet).minus(p.vendorFundedPerUnit).minus(p.firingiFundedPerUnit),
    };
  }));
  const pl = (l: Line): PricedLine => ({
    key: l.item.offerId, offerId: l.item.offerId, vendorCompanyId: l.item.vendorCompanyId, productId: l.item.productId, categoryIds: l.item.categoryIds, qty: l.item.qty,
    unitSaleNet: l.unitSale, lineNet: l.unitSale.mul(l.item.qty).toDecimalPlaces(2),
  });
  const take = (d: OrderDiscount) => {
    for (const l of lines) {
      const x = d.perLine.get(l.item.offerId);
      if (!x || x.perUnit.lte(0)) continue;
      l.discounts.push({ promotionId: d.promotionId, ownerType: d.ownerType, coupon: d.coupon, ...x });
      l.unitSale = l.unitSale.minus(x.perUnit);
    }
  };
  const groups = sellerIds.map((sellerId) => ({ sellerId, lines: lines.filter((l) => l.item.vendorCompanyId === sellerId) })).filter((g) => g.lines.length);

  // 2. per supplier: automatic € off the order and free delivery
  const autoFree = new Map<string, FreeDelivery | null>();
  for (const g of fixed ? [] : groups) {
    const r = orderPromotionsFor(promos, noCoupon, g.lines.filter((l) => !l.item.deal).map(pl));
    r.discounts.forEach(take);
    autoFree.set(g.sellerId, r.freeDelivery);
  }

  // 2b. loyalty: the tier's free delivery (FIRINGI pays) where no other offer gives it
  const { buyerPerks, LOYALTY_PROMOTION_ID, ensureLoyaltyPromotion } = await import("@/server/loyalty/pricing");
  const perks = await buyerPerks(ctx.company.id);
  if (perks?.freeDelivery && !fixed) {
    await ensureLoyaltyPromotion();
    for (const g of groups) if (!autoFree.get(g.sellerId)) autoFree.set(g.sellerId, { promotionId: LOYALTY_PROMOTION_ID, funder: "FIRINGI", coupon: false });
  }

  // 3. the coupon's € off / free delivery over the whole checkout
  let couponFree: FreeDelivery | null = null;
  let orderCoupon = new Decimal(0);
  if (coupon && (coupon.promo.kind === "ORDER_AMOUNT" || coupon.promo.kind === "FREE_DELIVERY")) {
    const all = lines.filter((l) => !l.item.deal).map(pl);
    const byKey = new Map(all.map((l) => [l.key, l]));
    const cand = { ...candidateOf(coupon.promo), minOrderValue: coupon.promo.minOrderValue?.toString() ?? null, matches: (k: string) => { const l = byKey.get(k)!; return promoMatchesOffer(coupon!.promo, { id: l.offerId, vendorCompanyId: l.vendorCompanyId, productId: l.productId, categoryIds: l.categoryIds }); } };
    const r = applyOrderPromotions(all, [cand]);
    r.discounts.forEach((d) => { take(d); orderCoupon = orderCoupon.plus(d.total); });
    couponFree = r.freeDelivery;
  }

  // the coupon must do something for this cart
  if (coupon) {
    const lineCoupon = lines.reduce((a, l) => a.plus(l.discounts.filter((d) => d.coupon && l.item.price!.promotions.some((p) => p.id === d.promotionId)).reduce((s, d) => s.plus(d.perUnit.mul(l.item.qty)), new Decimal(0))), new Decimal(0));
    const effect = couponEffect(coupon.promo, items.filter((i) => i.price && !i.deal).map((i) => ({
      key: i.offerId, offerId: i.offerId, vendorCompanyId: i.vendorCompanyId, productId: i.productId, categoryIds: i.categoryIds, qty: i.qty, unitSaleNet: i.price!.unitPriceNet, lineNet: new Decimal(i.price!.unitPriceNet).mul(i.qty).toDecimalPlaces(2),
    })), { lineCoupon, orderCoupon, freeDelivery: !!couponFree });
    if (!effect.ok) {
      const again = await priceCheckout(ctx, cart, { ...opts, skipCoupon: true });
      return { ...again, coupon: { code: coupon.promo.code!, ok: false, error: couponError(effect) } };
    }
  }

  // 3b. loyalty points: € off the whole checkout after every other discount, at most maxRedeemPct %
  // of the goods, spread over the lines like a coupon — FIRINGI pays (supplier payouts don't change).
  let loyalty: PricedCheckout["loyalty"] = null;
  if (perks && !fixed) {
    const s = perks.settings;
    const requested = Math.max(0, Math.floor(opts.loyaltyPoints ?? 0));
    const goodsNow = lines.reduce((a, l) => a.plus(l.unitSale.mul(l.item.qty)), new Decimal(0));
    const cap = goodsNow.mul(s.maxRedeemPct).div(100);
    const maxPoints = Math.floor(cap.div(s.pointValue).toNumber());
    let used = 0, reason: NonNullable<PricedCheckout["loyalty"]>["reason"] = null;
    if (requested > 0) {
      if (requested < s.minRedeem) reason = "BELOW_MIN";
      else if (requested > perks.balance) reason = "NOT_ENOUGH";
      else { used = Math.min(requested, maxPoints); if (used < requested) reason = "CAPPED"; }
    }
    let euros = new Decimal(used).mul(s.pointValue).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    if (euros.gt(0)) {
      await ensureLoyaltyPromotion();
      const all = lines.map((l) => ({ key: l.item.offerId, qty: l.item.qty, lineNet: l.unitSale.mul(l.item.qty).toDecimalPlaces(2), unitSaleNet: l.unitSale }));
      const r = applyOrderPromotions(all, [{ id: LOYALTY_PROMOTION_ID, ownerType: "ADMIN", kind: "ORDER_AMOUNT", value: euros, firingiFundPct: 100, vendorFundPct: 0, coupon: false, matches: () => true }]);
      const d = r.discounts[0];
      if (d) { take({ ...d, coupon: false }); euros = d.total; } else { used = 0; euros = new Decimal(0); }
    }
    loyalty = { requested, used, euros, maxPoints, balance: perks.balance, freeDelivery: perks.freeDelivery, reason };
  }

  // 4. per supplier: delivery, totals, redemptions
  const parts: SupplierPart[] = [];
  for (const g of groups) {
    const calcLines = g.lines.map((l) => {
      const firingi = l.discounts.reduce((a, d) => a.plus(d.firingiPerUnit), new Decimal(0));
      const vendor = l.discounts.reduce((a, d) => a.plus(d.vendorPerUnit), new Decimal(0));
      const calc = computeLine({
        qty: l.item.qty, unitListPriceNet: l.item.price!.listUnitNet, vatRatePercent: l.rate,
        commissionRatePercent: l.item.deal?.commissionPct ?? opts.commissionRates?.get(g.sellerId) ?? 0,
        vendorFundedDiscountPerUnit: l.item.deal ? new Decimal(l.item.price!.vendorFundedPerUnit) : vendor, firingiFundedDiscountPerUnit: firingi,
        commissionUnitBase: l.item.deal ? l.item.deal.unit : null,
      });
      return { item: l.item, rate: l.rate, discounts: l.discounts, calc: { ...calc, qty: l.item.qty }, deal: l.item.deal ?? null };
    });
    const goodsNet = calcLines.reduce((a, l) => a.plus(l.calc.lineNet), new Decimal(0));
    const seller = await prisma.company.findUniqueOrThrow({ where: { id: g.sellerId }, select: { countryId: true } });
    const rules = await deliveryRulesFor(ctx.company.countryId, g.sellerId, opts.addressId);
    // Phase 32: the delivery minimum counts the goods before the points discount (using points never adds a fee)
    const pointsOff = calcLines.reduce((a, l) => a.plus(l.discounts.filter((d) => d.promotionId === LOYALTY_PROMOTION_ID).reduce((x, d) => x.plus(d.perUnit.mul(l.item.qty)), new Decimal(0))), new Decimal(0));
    const input = {
      goodsNet: goodsNet.plus(pointsOff.toDecimalPlaces(2)), units: calcLines.reduce((a, l) => a + l.calc.qty, 0), supplierDelivers: ctx.company.type === "WHOLESALER",
      crossBorder: seller.countryId !== ctx.company.countryId, firingi: firingiInput(rules.firingi), vendor: vendorInput(rules.vendor),
    };
    // The coupon's free delivery counts for a supplier whose goods it applies to; else the automatic one.
    const couponHere = couponFree && coupon && g.lines.some((l) => promoMatchesOffer(coupon!.promo, { id: l.item.offerId, vendorCompanyId: l.item.vendorCompanyId, productId: l.item.productId, categoryIds: l.item.categoryIds })) ? couponFree : null;
    const free = couponHere ?? autoFree.get(g.sellerId) ?? null;
    const normal = decideDelivery(input);
    const decision = free?.funder === "VENDOR" ? decideDelivery({ ...input, vendorFree: true }) : normal;
    const normalFee = normal.ok ? normal.feeNet : new Decimal(0);
    const waived = free?.funder === "FIRINGI" && decision.ok ? decision.feeNet : new Decimal(0);
    const chargedFee = decision.ok ? decision.feeNet.minus(waived) : new Decimal(0);
    const feeRule = decision.ok ? (decision.feeOwner === "VENDOR" ? rules.vendor : rules.firingi) : null;
    const feeVatRate = chargedFee.gt(0) && feeRule?.feeTaxCategoryId ? await vatRate(prisma, ctx.company.countryId, opts.regionId, feeRule.feeTaxCategoryId) : new Decimal(0);
    const toVendor = decision.ok && decision.feeOwner === "VENDOR";
    const totals = computeTotals(calcLines.map((l) => l.calc), { feeNet: chargedFee, feeVatPercent: feeVatRate, toVendor, firingiPaysVendorFeeNet: toVendor ? waived : 0 });
    const freeUsed = free && normalFee.gt(0) ? free : null;
    const redemptions: RedemptionIn[] = [];
    for (const l of calcLines)
      for (const d of l.discounts)
        redemptions.push({ promotionId: d.promotionId, code: d.coupon ? coupon?.promo.code : null, amount: d.perUnit.mul(l.item.qty), firingiAmount: d.firingiPerUnit.mul(l.item.qty).toDecimalPlaces(2), vendorAmount: d.vendorPerUnit.mul(l.item.qty).toDecimalPlaces(2) });
    if (freeUsed)
      redemptions.push({ promotionId: freeUsed.promotionId, code: freeUsed.coupon ? coupon?.promo.code : null, amount: normalFee, firingiAmount: freeUsed.funder === "FIRINGI" ? normalFee : new Decimal(0), vendorAmount: freeUsed.funder === "VENDOR" ? normalFee : new Decimal(0) });
    parts.push({
      sellerId: g.sellerId, lines: calcLines, goodsNet, decision, normalFee, chargedFee, waived, feeVatRate, feeRuleId: decision.ok ? decision.ruleId : null, totals, redemptions,
      deliveryPromotionId: freeUsed?.promotionId ?? null, freeDelivery: freeUsed ? { funder: freeUsed.funder, amount: normalFee } : null,
    });
  }

  const sum = (f: (p: SupplierPart) => Decimal) => parts.reduce((a, p) => a.plus(f(p)), new Decimal(0));
  return {
    parts, unavailable,
    goodsNet: sum((p) => p.totals.goodsNet), netTotal: sum((p) => p.totals.netTotal), vatTotal: sum((p) => p.totals.vatTotal), grandTotal: sum((p) => p.totals.grandTotal),
    couponSavings: coupon ? parts.flatMap((p) => p.redemptions).filter((r) => r.promotionId === coupon!.promo.id).reduce((a, r) => a.plus(r.firingiAmount).plus(r.vendorAmount), new Decimal(0)) : new Decimal(0),
    coupon: cart.couponCode ? (couponErr ? { code: cart.couponCode, ok: false, error: couponErr } : coupon ? { code: coupon.promo.code!, ok: true, error: null } : null) : null,
    loyalty,
  };
}
