/** Open tenders (Phase 50) — pure rules: FIRINGI's switches and comparing sealed bids per line. */
export type TenderSettings = {
  enabled: boolean;
  /** who may post tenders */
  buyers: { CUSTOMER: boolean; WHOLESALER: boolean };
  /** who may bid (customers buy from wholesalers, wholesalers from distributors) */
  suppliers: { WHOLESALER: boolean; DISTRIBUTOR: boolean };
  /** ALWAYS = FIRINGI checks each tender before it opens; AUTO = tenders open at once */
  approval: "ALWAYS" | "AUTO";
  /** buyers may invite chosen suppliers only */
  invitations: boolean;
  /** buyers may show a target price per line */
  targetPrices: boolean;
  /** pay later at the award (Phase 50 pay later must be on too) */
  payLater: boolean;
  maxLines: number;
  /** bidding stays open between these */
  minHours: number;
  maxDays: number;
  /** a closed tender not awarded within this many days ends */
  awardDays: number;
};

export const DEFAULT_TENDER_SETTINGS: TenderSettings = {
  enabled: true,
  buyers: { CUSTOMER: true, WHOLESALER: true },
  suppliers: { WHOLESALER: true, DISTRIBUTOR: true },
  approval: "AUTO", invitations: true, targetPrices: true, payLater: true,
  maxLines: 50, minHours: 24, maxDays: 30, awardDays: 14,
};

export function mergeTenderSettings(v: Partial<TenderSettings> | null | undefined): TenderSettings {
  const d = DEFAULT_TENDER_SETTINGS, x = v ?? {};
  return { ...d, ...x, buyers: { ...d.buyers, ...(x.buyers ?? {}) }, suppliers: { ...d.suppliers, ...(x.suppliers ?? {}) } };
}

export function cleanTenderSettings(i: TenderSettings): TenderSettings {
  const n = (x: unknown, lo: number, hi: number, label: string) => { const v = Math.round(Number(x)); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`); return v; };
  const minHours = n(i.minHours, 1, 240, "Shortest bidding time (hours)"), maxDays = n(i.maxDays, 1, 90, "Longest bidding time (days)");
  if (minHours > maxDays * 24) throw new Error("The shortest bidding time is longer than the longest.");
  return {
    enabled: !!i.enabled, buyers: { CUSTOMER: !!i.buyers?.CUSTOMER, WHOLESALER: !!i.buyers?.WHOLESALER }, suppliers: { WHOLESALER: !!i.suppliers?.WHOLESALER, DISTRIBUTOR: !!i.suppliers?.DISTRIBUTOR },
    approval: i.approval === "ALWAYS" ? "ALWAYS" : "AUTO", invitations: !!i.invitations, targetPrices: !!i.targetPrices, payLater: !!i.payLater,
    maxLines: n(i.maxLines, 1, 500, "Lines per tender"), minHours, maxDays, awardDays: n(i.awardDays, 1, 90, "Days to award"),
  };
}

/** Customers buy from wholesalers, wholesalers from distributors. */
export const SUPPLIER_TYPE: Record<"CUSTOMER" | "WHOLESALER", "WHOLESALER" | "DISTRIBUTOR"> = { CUSTOMER: "WHOLESALER", WHOLESALER: "DISTRIBUTOR" };

export type BidOnLine = { bidLineId: string; supplierId: string; unitNet: number };
/** The bids on one line, cheapest first (ties: the earlier in the list); with the saving against the target. */
export function rankBids<T extends BidOnLine>(bids: T[], target?: number | null) {
  return bids.map((b, k) => ({ b, k })).sort((x, y) => x.b.unitNet - y.b.unitNet || x.k - y.k)
    .map(({ b }, i): T & { rank: number; belowTarget: number | null } => ({ ...b, rank: i + 1, belowTarget: target != null ? Math.round((target - b.unitNet) * 10000) / 10000 : null }));
}

/** The cheapest bid per line → a suggested award (lineId → bidLineId). */
export function cheapestAward(lines: { id: string; bids: BidOnLine[] }[]) {
  return Object.fromEntries(lines.filter((l) => l.bids.length).map((l) => [l.id, rankBids(l.bids)[0].bidLineId]));
}

/** Awarded lines grouped by supplier (one order each). */
export function groupAward<L extends { lineId: string; supplierId: string }>(picks: L[]) {
  const m = new Map<string, L[]>();
  for (const p of picks) m.set(p.supplierId, [...(m.get(p.supplierId) ?? []), p]);
  return m;
}
