/** Clearance deals (Phase 38) — kinds, settings and the pure price maths (shared by server and pages). */

export const DEAL_KINDS = ["FLASH", "BUNDLE", "VOLUME", "LOT", "BEST_OFFER"] as const;
export type DealKindKey = (typeof DEAL_KINDS)[number];

export type DealSettings = {
  /** Which kinds suppliers may create (FIRINGI switches each on or off). */
  kinds: Record<DealKindKey, boolean>;
  approval: {
    /** ALWAYS: every deal waits for FIRINGI. AUTO: deals within the limits start by themselves; the rest wait. */
    mode: "ALWAYS" | "AUTO";
    maxDiscountPct: number;
    maxDays: number;
    /** AUTO only for suppliers FIRINGI marked as trusted. */
    trustedOnly: boolean;
  };
  /** A deal must be at least this much below the list price. */
  minDiscountPct: number;
  maxDurationDays: number;
  clearance: {
    /** A deal on a lot that expires within this many days (or on overstock) is a clearance deal. */
    expiryDays: number;
    overstock: boolean;
    /** FIRINGI's commission on clearance deals (on the deal price; never more than the supplier's usual rate). */
    commissionPct: number;
  };
  bestOffer: { answerHours: number; holdHours: number };
  alerts: { smart: boolean; lookbackDays: number; watch: boolean; digest: boolean; maxPerDay: number };
};

export const DEFAULT_DEAL_SETTINGS: DealSettings = {
  kinds: { FLASH: true, BUNDLE: true, VOLUME: true, LOT: true, BEST_OFFER: true },
  approval: { mode: "AUTO", maxDiscountPct: 50, maxDays: 14, trustedOnly: false },
  minDiscountPct: 5,
  maxDurationDays: 30,
  clearance: { expiryDays: 21, overstock: true, commissionPct: 4 },
  bestOffer: { answerHours: 24, holdHours: 48 },
  alerts: { smart: true, lookbackDays: 180, watch: true, digest: true, maxPerDay: 3 },
};

export type Tier = { minQty: number; unitPrice: number };
export type DealTerms = {
  kind: DealKindKey;
  dealPrice?: number | null;
  bundleQty?: number | null;
  bundlePrice?: number | null;
  tiers?: Tier[] | null;
  maxQty?: number | null;
  lotPrice?: number | null;
};

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The unit price (net) a buyer pays for `qty` on a deal, or why the deal doesn't apply.
 * BEST_OFFER prices come from an accepted bid, not from here.
 */
export function dealUnitPrice(d: DealTerms, qty: number, listUnit: number): { ok: true; unit: number } | { ok: false; reason: "QTY_TIER" | "LOT_QTY" | "BUNDLE_QTY" | "NOT_CHEAPER" | "BID" } {
  let unit: number;
  switch (d.kind) {
    case "FLASH":
      unit = Number(d.dealPrice);
      break;
    case "VOLUME": {
      const t = [...(d.tiers ?? [])].sort((a, b) => b.minQty - a.minQty).find((x) => qty >= x.minQty);
      if (!t) return { ok: false, reason: "QTY_TIER" };
      unit = t.unitPrice;
      break;
    }
    case "BUNDLE": {
      const n = Number(d.bundleQty), p = Number(d.bundlePrice);
      if (!n || qty < n) return { ok: false, reason: "BUNDLE_QTY" };
      const packs = Math.floor(qty / n);
      unit = (packs * p + (qty - packs * n) * listUnit) / qty;
      break;
    }
    case "LOT":
      if (qty !== Number(d.maxQty)) return { ok: false, reason: "LOT_QTY" };
      unit = Number(d.lotPrice) / qty;
      break;
    default:
      return { ok: false, reason: "BID" };
  }
  unit = r4(unit);
  if (!(unit > 0) || unit >= listUnit) return { ok: false, reason: "NOT_CHEAPER" };
  return { ok: true, unit };
}

/** The best (lowest) unit price a deal can give — for the badge / limits. */
export function bestDealUnit(d: DealTerms, listUnit: number): number | null {
  switch (d.kind) {
    case "FLASH": return d.dealPrice ?? null;
    case "VOLUME": return d.tiers?.length ? Math.min(...d.tiers.map((t) => t.unitPrice)) : null;
    case "BUNDLE": return d.bundleQty && d.bundlePrice ? r4(d.bundlePrice / d.bundleQty) : null;
    case "LOT": return d.maxQty && d.lotPrice ? r4(d.lotPrice / d.maxQty) : null;
    default: return null;
  }
}

export const discountPct = (unit: number | null, listUnit: number) => (unit == null || !(listUnit > 0) ? null : Math.round((1 - unit / listUnit) * 1000) / 10);
