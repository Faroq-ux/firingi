/**
 * Price resolution (pure). A buyer may match several price lists of a vendor:
 *   CUSTOMER / CONTRACT (made for this buyer)  >  CUSTOMER_GROUP  >  BASE
 * The most specific list that has a tier for the requested quantity wins; ties are
 * broken by list priority, then by the lower price. Within a list the highest tier
 * whose minQty ≤ qty applies.
 */
import Decimal from "decimal.js";
import type { PriceListScope } from "@prisma/client";

export type PriceCandidate = {
  priceListId: string;
  scope: PriceListScope;
  priority: number;
  minQty: number;
  unitPriceNet: Decimal.Value | { toString(): string };
};

export type ResolvedPrice = {
  unitPriceNet: Decimal;
  priceListId: string;
  scope: PriceListScope;
  minQty: number;
  /** All tiers of the winning list, ascending — for "from N units" displays. */
  tiers: { minQty: number; unitPriceNet: Decimal }[];
};

const RANK: Record<PriceListScope, number> = { CUSTOMER: 3, CONTRACT: 3, CUSTOMER_GROUP: 2, BASE: 1 };
const dec = (v: PriceCandidate["unitPriceNet"]) => new Decimal(v.toString());

export function resolvePrice(candidates: PriceCandidate[], qty = 1): ResolvedPrice | null {
  const byList = new Map<string, PriceCandidate[]>();
  for (const c of candidates) byList.set(c.priceListId, [...(byList.get(c.priceListId) ?? []), c]);

  let best: (ResolvedPrice & { rank: number; priority: number }) | null = null;
  for (const [listId, items] of byList) {
    const applicable = items.filter((i) => i.minQty <= qty).sort((a, b) => b.minQty - a.minQty)[0];
    if (!applicable) continue;
    const cand = {
      unitPriceNet: dec(applicable.unitPriceNet),
      priceListId: listId,
      scope: applicable.scope,
      minQty: applicable.minQty,
      tiers: items.map((i) => ({ minQty: i.minQty, unitPriceNet: dec(i.unitPriceNet) })).sort((a, b) => a.minQty - b.minQty),
      rank: RANK[applicable.scope],
      priority: applicable.priority,
    };
    if (
      !best ||
      cand.rank > best.rank ||
      (cand.rank === best.rank && cand.priority > best.priority) ||
      (cand.rank === best.rank && cand.priority === best.priority && cand.unitPriceNet.lt(best.unitPriceNet))
    )
      best = cand;
  }
  if (!best) return null;
  return { unitPriceNet: best.unitPriceNet, priceListId: best.priceListId, scope: best.scope, minQty: best.minQty, tiers: best.tiers };
}

/** Price incl. VAT for display, rounded to cents. */
export function grossOf(net: Decimal, vatPercent: Decimal.Value) {
  return net.mul(new Decimal(vatPercent).div(100).plus(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// ── Phase 45: price lists in other currencies ───────────────────────────────

export type FxCandidate = PriceCandidate & { currencyCode: string };
export type PriceFxRules = {
  /** the buyer's billing currency */ buyerCode: string;
  /** reference rates, units per € */ mids: Record<string, string>;
  /** fixed local price lists (in the buyer's currency) are used exactly */ localLists: boolean;
  /** suppliers' price lists in their own currency */ supplierCurrency: boolean;
};

/**
 * Price-list prices in EUR so they can be compared and priced as before. A list in the buyer's own currency
 * (fixed local price) is preferred and kept exactly (`fixed`: list → its prices by tier); a supplier's list in
 * its own currency is converted at the reference rate. Lists that can't be used (switched off / no rate) drop out.
 */
export function candidatesInEur(cands: FxCandidate[], r: PriceFxRules) {
  const out: PriceCandidate[] = [];
  const fixed = new Map<string, { code: string; byMinQty: Map<number, string> }>();
  for (const c of cands) {
    const code = c.currencyCode || "EUR";
    if (code === "EUR") { out.push(c); continue; }
    const mid = r.mids[code];
    if (!mid) continue;
    const local = code === r.buyerCode;
    if (local ? !r.localLists : !r.supplierCurrency) continue;
    out.push({ ...c, priority: local ? c.priority + 1000 : c.priority, unitPriceNet: new Decimal(c.unitPriceNet.toString()).div(mid).toDecimalPlaces(4, Decimal.ROUND_HALF_UP) });
    if (local) {
      const f = fixed.get(c.priceListId) ?? { code, byMinQty: new Map() };
      f.byMinQty.set(c.minQty, new Decimal(c.unitPriceNet.toString()).toFixed(4));
      fixed.set(c.priceListId, f);
    }
  }
  return { candidates: out, fixed };
}
