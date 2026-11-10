/**
 * Promotion engine (pure).
 *
 *  • Vendor promotion — created by the vendor, 100 % paid by the vendor.
 *  • Admin promotion  — created by FIRINGI, paid by FIRINGI, the vendor, or a split
 *    (e.g. 50/50). A vendor-funded share only applies if the vendor accepted it.
 *  • Coupon           — a vendor or admin promotion with a code; applies only when the
 *    buyer entered that code (one coupon per order).
 *
 * Per order line: at most ONE vendor promotion and ONE admin promotion (the best of
 * each), then the coupon. The vendor promotion is applied first; each next one applies to
 * the price after it. Commission is ALWAYS on the pre-discount list price (see calc.ts),
 * so discounts never reduce FIRINGI's commission.
 *
 * Line kinds: PERCENT, FIXED_AMOUNT (€ off per unit), BUY_X_GET_Y (buy X, get Y free —
 * spread over the units of the line). Order kinds (see applyOrderPromotions): ORDER_AMOUNT
 * (€ off the order, spread over the matching lines in proportion to their value) and
 * FREE_DELIVERY.
 */
import Decimal from "decimal.js";

export type PromoKind = "PERCENT" | "FIXED_AMOUNT" | "BUY_X_GET_Y" | "ORDER_AMOUNT" | "FREE_DELIVERY";
export const LINE_KINDS: PromoKind[] = ["PERCENT", "FIXED_AMOUNT", "BUY_X_GET_Y"];

export type PromoCandidate = {
  id: string;
  ownerType: "VENDOR" | "ADMIN";
  kind: PromoKind;
  value: Decimal.Value;
  firingiFundPct: Decimal.Value;
  vendorFundPct: Decimal.Value;
  minQty?: number | null;
  buyQty?: number | null;
  freeQty?: number | null;
  priority?: number;
  name?: string;
  /** Applies only because the buyer entered its code. */
  coupon?: boolean;
};

export type AppliedPromo = {
  promotionId: string;
  ownerType: "VENDOR" | "ADMIN";
  name?: string;
  coupon?: boolean;
  perUnit: Decimal; // discount per unit (net)
  firingiPerUnit: Decimal;
  vendorPerUnit: Decimal;
};

const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const r4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

/** Discount per unit of `p` on a unit price, for a line of `qty` units. */
export function discountOn(price: Decimal, p: PromoCandidate, qty: number) {
  let d: Decimal;
  if (p.kind === "PERCENT") d = price.mul(new Decimal(p.value)).div(100);
  else if (p.kind === "FIXED_AMOUNT") d = new Decimal(p.value);
  else if (p.kind === "BUY_X_GET_Y") {
    const buy = p.buyQty ?? 0, free = p.freeQty ?? 0;
    if (buy < 1 || free < 1 || qty < 1) return new Decimal(0);
    const freeUnits = Math.floor(qty / (buy + free)) * free;
    d = price.mul(freeUnits).div(qty);
  } else return new Decimal(0); // order kinds don't act on a line
  return r4(Decimal.min(d, price)); // never below zero
}

function best(cands: PromoCandidate[], price: Decimal, qty: number) {
  return cands
    .filter((p) => !p.minQty || qty >= p.minQty)
    .map((p) => ({ p, d: discountOn(price, p, qty) }))
    .filter((x) => x.d.gt(0))
    .sort((a, b) => b.d.comparedTo(a.d) || (b.p.priority ?? 0) - (a.p.priority ?? 0))[0];
}

function split(p: PromoCandidate, d: Decimal) {
  if (p.ownerType === "VENDOR") return { firingi: new Decimal(0), vendor: d };
  const firingi = r4(d.mul(new Decimal(p.firingiFundPct)).div(100));
  return { firingi, vendor: d.minus(firingi) };
}

export function applyPromotions(listPriceNet: Decimal.Value, qty: number, candidates: PromoCandidate[]) {
  const list = new Decimal(listPriceNet);
  const applied: AppliedPromo[] = [];
  const lineCands = candidates.filter((c) => LINE_KINDS.includes(c.kind));
  let price = list;
  const take = (x: { p: PromoCandidate; d: Decimal } | undefined) => {
    if (!x) return;
    const s = split(x.p, x.d);
    applied.push({ promotionId: x.p.id, ownerType: x.p.ownerType, name: x.p.name, coupon: !!x.p.coupon, perUnit: x.d, firingiPerUnit: s.firingi, vendorPerUnit: s.vendor });
    price = price.minus(x.d);
  };
  take(best(lineCands.filter((c) => c.ownerType === "VENDOR" && !c.coupon), price, qty));
  take(best(lineCands.filter((c) => c.ownerType === "ADMIN" && !c.coupon), price, qty));
  take(best(lineCands.filter((c) => c.coupon), price, qty));
  const sum = (f: (x: AppliedPromo) => Decimal) => applied.reduce((acc, x) => acc.plus(f(x)), new Decimal(0));
  const of = (owner: "VENDOR" | "ADMIN") => applied.filter((x) => x.ownerType === owner).reduce((a, x) => a.plus(x.perUnit), new Decimal(0));
  return {
    listPriceNet: list,
    salePriceNet: price,
    vendorDiscountPerUnit: of("VENDOR"),
    adminDiscountPerUnit: of("ADMIN"),
    firingiFundedPerUnit: sum((x) => x.firingiPerUnit),
    vendorFundedPerUnit: sum((x) => x.vendorPerUnit),
    applied,
  };
}

// ── order level ─────────────────────────────────────────────────────────────

export type OrderLineIn = { key: string; qty: number; lineNet: Decimal.Value; unitSaleNet: Decimal.Value };
export type OrderPromo = PromoCandidate & { minOrderValue?: Decimal.Value | null; matches: (key: string) => boolean };

export type OrderDiscount = {
  promotionId: string;
  ownerType: "VENDOR" | "ADMIN";
  coupon: boolean;
  total: Decimal;
  /** Extra discount per unit for each line (net, 4 decimals), split by who pays. */
  perLine: Map<string, { perUnit: Decimal; firingiPerUnit: Decimal; vendorPerUnit: Decimal }>;
};
export type FreeDelivery = { promotionId: string; funder: "FIRINGI" | "VENDOR"; coupon: boolean };

/**
 * € off the order and free delivery. Goods value = the lines after line promotions.
 * At most one automatic € off and the coupon (if it is a € off); free delivery from the
 * coupon if it is one, else the first eligible automatic offer.
 */
export function applyOrderPromotions(lines: OrderLineIn[], candidates: OrderPromo[]) {
  const goods = lines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
  const eligible = candidates.filter((c) => !c.minOrderValue || goods.gte(c.minOrderValue));
  const discounts: OrderDiscount[] = [];
  const remaining = new Map(lines.map((l) => [l.key, new Decimal(l.unitSaleNet)]));

  const spread = (p: OrderPromo) => {
    const ls = lines.filter((l) => p.matches(l.key) && l.qty > 0);
    const base = ls.reduce((a, l) => a.plus(remaining.get(l.key)!.mul(l.qty)), new Decimal(0));
    if (base.lte(0)) return;
    const total = r2(Decimal.min(new Decimal(p.value), base));
    if (total.lte(0)) return;
    const perLine = new Map<string, { perUnit: Decimal; firingiPerUnit: Decimal; vendorPerUnit: Decimal }>();
    let given = new Decimal(0);
    ls.forEach((l, i) => {
      const unit = remaining.get(l.key)!;
      const share = i === ls.length - 1 ? total.minus(given) : r2(total.mul(unit.mul(l.qty)).div(base));
      given = given.plus(share);
      const perUnit = r4(Decimal.min(share.div(l.qty), unit));
      const s = split(p, perUnit);
      perLine.set(l.key, { perUnit, firingiPerUnit: s.firingi, vendorPerUnit: s.vendor });
      remaining.set(l.key, unit.minus(perUnit));
    });
    discounts.push({ promotionId: p.id, ownerType: p.ownerType, coupon: !!p.coupon, total, perLine });
  };
  const amounts = eligible.filter((c) => c.kind === "ORDER_AMOUNT");
  const auto = amounts.filter((c) => !c.coupon).sort((a, b) => new Decimal(b.value).comparedTo(new Decimal(a.value)) || (b.priority ?? 0) - (a.priority ?? 0))[0];
  if (auto) spread(auto);
  const couponAmount = amounts.find((c) => c.coupon);
  if (couponAmount) spread(couponAmount);

  const frees = eligible.filter((c) => c.kind === "FREE_DELIVERY");
  const free = frees.find((c) => c.coupon) ?? frees[0];
  const freeDelivery: FreeDelivery | null = free
    ? { promotionId: free.id, funder: free.ownerType === "VENDOR" || new Decimal(free.firingiFundPct).eq(0) ? "VENDOR" : "FIRINGI", coupon: !!free.coupon }
    : null;
  return { goods, discounts, freeDelivery };
}
