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
