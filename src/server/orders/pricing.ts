/**
 * Checkout pricing for a cart from one supplier — the same numbers for the cart preview and
 * for placing the order:
 *
 *   1. lines at the buyer's price (list / contract price − vendor offer − FIRINGI offer − coupon)
 *   2. € off the order (automatic customer offer and/or coupon), spread over the matching lines
 *   3. delivery: who delivers and the fee, on the goods after discounts; a free-delivery offer
 *      either has the supplier deliver free (supplier-paid) or waives the fee (FIRINGI-paid —
 *      FIRINGI still pays a supplier's flat rate)
 *   4. totals, and what each promotion gave (redemptions)
 *
 * A coupon that doesn't work for this cart (minimum order, nothing it applies to …) is reported
 * in `coupon.error` and the cart is priced without it; placing the order then fails.
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { computeLine, computeTotals } from "./calc";
import { decideDelivery, firingiInput, vendorInput } from "./delivery-rule";
import { deliveryRulesFor } from "@/server/services/cart";
import { vatRate } from "@/server/services/orders";
import { loadActivePromotions } from "@/server/services/promotions";
import { buyerPromoContext, couponEffect, couponError, findCoupon, orderPromotionsFor, type PricedLine, type RedemptionIn } from "@/server/marketing/offers";

export type LineDiscount = { promotionId: string; ownerType: "VENDOR" | "ADMIN"; coupon: boolean; perUnit: Decimal; firingiPerUnit: Decimal; vendorPerUnit: Decimal };

type Opts = { regionId: string | null; addressId: string | null; commissionRate?: Decimal.Value | null; skipCoupon?: boolean };

export async function priceCart(ctx: Ctx, cart: { items: { offerId: string; qty: number }[]; sellerId: string; couponCode: string | null }, opts: Opts): Promise<PricedCart> {
  // 1. coupon (buyer-level checks) — an invalid one is reported and ignored here
  let coupon: Awaited<ReturnType<typeof findCoupon>> | null = null;
  let couponErr: AppError | null = null;
  if (cart.couponCode && !opts.skipCoupon) {
    try { coupon = await findCoupon(ctx, cart.couponCode, { sellerId: cart.sellerId, routed: false }); } catch (e) { if (e instanceof AppError) couponErr = e; else throw e; }
  }
  const promos = coupon?.promos ?? (await loadActivePromotions(ctx.company.countryId));
  const buyer = coupon?.buyer ?? (await buyerPromoContext(ctx.company.id, promos, null));

  const { items, unavailable } = await pricedOffers(ctx, cart.items, { couponId: coupon?.promo.id ?? null });
  const priced = items.filter((i) => i.price);

  // 2. lines after line promotions, then € off the order
  const base = await Promise.all(priced.map(async (i) => {
    const p = i.price!;
    const discounts: LineDiscount[] = p.promotions.map((x) => ({
      promotionId: x.id, ownerType: x.ownerType, coupon: x.coupon, perUnit: new Decimal(x.perUnit), firingiPerUnit: new Decimal(x.firingiPerUnit), vendorPerUnit: new Decimal(x.vendorPerUnit),
    }));
    const unitSale = new Decimal(p.listUnitNet).minus(p.vendorFundedPerUnit).minus(p.firingiFundedPerUnit);
    const rate = await vatRate(prisma, ctx.company.countryId, opts.regionId, i.taxCategoryId);
    return { item: i, rate, discounts, unitSale };
  }));
  const plines: PricedLine[] = base.map((b) => ({
    key: b.item.offerId, offerId: b.item.offerId, vendorCompanyId: b.item.vendorCompanyId, productId: b.item.productId, categoryIds: b.item.categoryIds, qty: b.item.qty,
    unitSaleNet: b.unitSale, lineNet: b.unitSale.mul(b.item.qty).toDecimalPlaces(2),
  }));
  const order = orderPromotionsFor(promos, buyer, plines);
  for (const d of order.discounts)
    for (const b of base) {
      const x = d.perLine.get(b.item.offerId);
      if (x && x.perUnit.gt(0)) b.discounts.push({ promotionId: d.promotionId, ownerType: d.ownerType, coupon: d.coupon, ...x });
    }

  const lines = base.map((b) => {
    const firingi = b.discounts.reduce((a, d) => a.plus(d.firingiPerUnit), new Decimal(0));
    const vendor = b.discounts.reduce((a, d) => a.plus(d.vendorPerUnit), new Decimal(0));
    const calc = computeLine({
      qty: b.item.qty, unitListPriceNet: b.item.price!.listUnitNet, vatRatePercent: b.rate, commissionRatePercent: opts.commissionRate ?? 0,
      vendorFundedDiscountPerUnit: vendor, firingiFundedDiscountPerUnit: firingi,
    });
    return { item: b.item, rate: b.rate, discounts: b.discounts, calc: { ...calc, qty: b.item.qty } };
  });
  const goodsNet = lines.reduce((a, l) => a.plus(l.calc.lineNet), new Decimal(0));

  // 3. the coupon must do something for this cart
  if (coupon) {
    const lineCoupon = lines.reduce((a, l) => a.plus(l.discounts.filter((d) => d.coupon && !order.discounts.some((o) => o.promotionId === d.promotionId)).reduce((s, d) => s.plus(d.perUnit.mul(l.item.qty)), new Decimal(0))), new Decimal(0));
    const orderCoupon = order.discounts.find((d) => d.coupon)?.total ?? new Decimal(0);
    const effect = couponEffect(coupon.promo, plines, { lineCoupon, orderCoupon, freeDelivery: !!order.freeDelivery?.coupon });
    if (!effect.ok) {
      const again = await priceCart(ctx, cart, { ...opts, skipCoupon: true });
      return { ...again, coupon: { code: coupon.promo.code!, ok: false, error: couponError(effect) } };
    }
  }

  // 4. delivery
  const seller = await prisma.company.findUniqueOrThrow({ where: { id: cart.sellerId }, select: { countryId: true } });
  const rules = await deliveryRulesFor(ctx.company.countryId, cart.sellerId, opts.addressId);
  const input = {
    goodsNet, units: lines.reduce((a, l) => a + l.calc.qty, 0), supplierDelivers: ctx.company.type === "WHOLESALER",
    crossBorder: seller.countryId !== ctx.company.countryId, firingi: firingiInput(rules.firingi), vendor: vendorInput(rules.vendor),
  };
  const normal = decideDelivery(input);
  const free = order.freeDelivery;
  const decision = free?.funder === "VENDOR" ? decideDelivery({ ...input, vendorFree: true }) : normal;
  const normalFee = normal.ok ? normal.feeNet : new Decimal(0);
  const waived = free?.funder === "FIRINGI" && decision.ok ? decision.feeNet : new Decimal(0);
  const chargedFee = decision.ok ? decision.feeNet.minus(waived) : new Decimal(0);
  const feeRule = decision.ok ? (decision.feeOwner === "VENDOR" ? rules.vendor : rules.firingi) : null;
  const feeVatRate = chargedFee.gt(0) && feeRule?.feeTaxCategoryId ? await vatRate(prisma, ctx.company.countryId, opts.regionId, feeRule.feeTaxCategoryId) : new Decimal(0);
  const toVendor = decision.ok && decision.feeOwner === "VENDOR";
  const totals = computeTotals(lines.map((l) => l.calc), { feeNet: chargedFee, feeVatPercent: feeVatRate, toVendor, firingiPaysVendorFeeNet: toVendor ? waived : 0 });
  const freeUsed = free && normalFee.gt(0) ? free : null;

  // 5. what each promotion gave
  const redemptions: RedemptionIn[] = [];
  for (const l of lines)
    for (const d of l.discounts)
      redemptions.push({ promotionId: d.promotionId, code: d.coupon ? coupon?.promo.code : null, amount: d.perUnit.mul(l.item.qty), firingiAmount: d.firingiPerUnit.mul(l.item.qty).toDecimalPlaces(2), vendorAmount: d.vendorPerUnit.mul(l.item.qty).toDecimalPlaces(2) });
  if (freeUsed)
    redemptions.push({ promotionId: freeUsed.promotionId, code: freeUsed.coupon ? coupon?.promo.code : null, amount: normalFee, firingiAmount: freeUsed.funder === "FIRINGI" ? normalFee : new Decimal(0), vendorAmount: freeUsed.funder === "VENDOR" ? normalFee : new Decimal(0) });

  return {
    lines, unavailable, goodsNet, decision, normalFee, chargedFee, waived, feeVatRate, feeRuleId: decision.ok ? decision.ruleId : null, totals, redemptions,
    deliveryPromotionId: freeUsed?.promotionId ?? null,
    freeDelivery: freeUsed ? { funder: freeUsed.funder, amount: normalFee } : null,
    couponSavings: coupon ? redemptions.filter((r) => r.promotionId === coupon!.promo.id).reduce((a, r) => a.plus(r.firingiAmount).plus(r.vendorAmount), new Decimal(0)) : new Decimal(0),
    coupon: cart.couponCode ? (couponErr ? { code: cart.couponCode, ok: false, error: couponErr } : coupon ? { code: coupon.promo.code!, ok: true, error: null } : null) : null,
  };
}

export type PricedCart = {
  lines: { item: Awaited<ReturnType<typeof pricedOffers>>["items"][number]; rate: Decimal; discounts: LineDiscount[]; calc: ReturnType<typeof computeLine> & { qty: number } }[];
  unavailable: string[];
  goodsNet: Decimal;
  decision: ReturnType<typeof decideDelivery>;
  normalFee: Decimal;
  chargedFee: Decimal;
  waived: Decimal;
  feeVatRate: Decimal;
  feeRuleId: string | null;
  totals: ReturnType<typeof computeTotals>;
  redemptions: RedemptionIn[];
  deliveryPromotionId: string | null;
  freeDelivery: { funder: "FIRINGI" | "VENDOR"; amount: Decimal } | null;
  couponSavings: Decimal;
  coupon: { code: string; ok: boolean; error: AppError | null } | null;
};
