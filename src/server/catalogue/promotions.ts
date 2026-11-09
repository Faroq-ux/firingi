/**
 * Promotion engine (pure).
 *
 *  • Vendor promotion — created by the vendor, 100 % paid by the vendor.
 *  • Admin promotion  — created by FIRINGI, paid by FIRINGI, the vendor, or a split
 *    (e.g. 50/50). A vendor-funded share only applies if the vendor accepted it.
 *
 * Per order line: at most ONE vendor promotion and ONE admin promotion (the best of
 * each). The vendor promotion is applied first; the admin promotion applies to the
 * price after it. Commission is ALWAYS on the pre-discount list price (see calc.ts),
 * so discounts never reduce FIRINGI's commission.
 */
import Decimal from "decimal.js";

export type PromoCandidate = {
  id: string;
  ownerType: "VENDOR" | "ADMIN";
  kind: "PERCENT" | "FIXED_AMOUNT"; // FIXED_AMOUNT = € off per unit (net)
  value: Decimal.Value;
  firingiFundPct: Decimal.Value;
  vendorFundPct: Decimal.Value;
  minQty?: number | null;
  priority?: number;
  name?: string;
};

export type AppliedPromo = {
  promotionId: string;
  ownerType: "VENDOR" | "ADMIN";
  name?: string;
  perUnit: Decimal; // discount per unit (net)
  firingiPerUnit: Decimal;
  vendorPerUnit: Decimal;
};

const r4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

function discountOn(price: Decimal, p: PromoCandidate) {
  const d = p.kind === "PERCENT" ? price.mul(new Decimal(p.value)).div(100) : new Decimal(p.value);
  return r4(Decimal.min(d, price)); // never below zero
}

function best(cands: PromoCandidate[], price: Decimal, qty: number) {
  return cands
    .filter((p) => !p.minQty || qty >= p.minQty)
    .map((p) => ({ p, d: discountOn(price, p) }))
    .filter((x) => x.d.gt(0))
    .sort((a, b) => b.d.comparedTo(a.d) || (b.p.priority ?? 0) - (a.p.priority ?? 0))[0];
}

export function applyPromotions(listPriceNet: Decimal.Value, qty: number, candidates: PromoCandidate[]) {
  const list = new Decimal(listPriceNet);
  const applied: AppliedPromo[] = [];

  const v = best(candidates.filter((c) => c.ownerType === "VENDOR"), list, qty);
  let price = list;
  if (v) {
    applied.push({ promotionId: v.p.id, ownerType: "VENDOR", name: v.p.name, perUnit: v.d, firingiPerUnit: new Decimal(0), vendorPerUnit: v.d });
    price = price.minus(v.d);
  }
  const a = best(candidates.filter((c) => c.ownerType === "ADMIN"), price, qty);
  if (a) {
    const firingi = r4(a.d.mul(new Decimal(a.p.firingiFundPct)).div(100));
    applied.push({ promotionId: a.p.id, ownerType: "ADMIN", name: a.p.name, perUnit: a.d, firingiPerUnit: firingi, vendorPerUnit: a.d.minus(firingi) });
    price = price.minus(a.d);
  }
  const sum = (f: (x: AppliedPromo) => Decimal) => applied.reduce((acc, x) => acc.plus(f(x)), new Decimal(0));
  return {
    listPriceNet: list,
    salePriceNet: price,
    vendorDiscountPerUnit: applied.find((x) => x.ownerType === "VENDOR")?.perUnit ?? new Decimal(0),
    adminDiscountPerUnit: applied.find((x) => x.ownerType === "ADMIN")?.perUnit ?? new Decimal(0),
    firingiFundedPerUnit: sum((x) => x.firingiPerUnit),
    vendorFundedPerUnit: sum((x) => x.vendorPerUnit),
    applied,
  };
}
