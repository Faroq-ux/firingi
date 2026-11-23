/**
 * Pre-orders and price locks — Phase 71. Pure rules shared by server and pages: tier prices by total pre-ordered,
 * the next tier, fair allocation when supply is short, deposits, who may pre-order from whom, and price-lock sums.
 */

export const CAMPAIGN_KINDS = ["SEASONAL", "LAUNCH", "SCARCE"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];
export const ALLOCATION_RULES = ["PRO_RATA", "FIRST_COME", "LOYAL_FIRST"] as const;
export type AllocationRule = (typeof ALLOCATION_RULES)[number];
export const SELLER_TYPES = ["DISTRIBUTOR", "WHOLESALER"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

/** The usual flow: distributors sell to wholesalers, wholesalers to customers. */
export const buyerTypeFor = (sellerType: string) => (sellerType === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER");

export type Tier = { minTotal: number; unitNet: number };
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Clean tiers: positive, sorted by threshold, each cheaper than the one before and than the base price. */
export function cleanTiers(base: number, tiers: unknown): Tier[] {
  const arr = Array.isArray(tiers) ? tiers : [];
  const ok = arr
    .map((t) => ({ minTotal: Math.round(Number((t as Tier)?.minTotal)), unitNet: r4(Number((t as Tier)?.unitNet)) }))
    .filter((t) => Number.isFinite(t.minTotal) && t.minTotal > 0 && Number.isFinite(t.unitNet) && t.unitNet > 0 && t.unitNet < base)
    .sort((a, b) => a.minTotal - b.minTotal);
  const out: Tier[] = [];
  for (const t of ok) if (!out.length || (t.minTotal > out[out.length - 1].minTotal && t.unitNet < out[out.length - 1].unitNet)) out.push(t);
  return out.slice(0, 5);
}

/** Price per pack for everyone once `total` packs are pre-ordered. */
export function tierPrice(base: number, tiers: Tier[], total: number) {
  let p = base;
  for (const t of tiers) if (total >= t.minTotal) p = Math.min(p, t.unitNet);
  return p;
}
/** The next tier still to reach and how many packs are missing. */
export function nextTier(tiers: Tier[], total: number) {
  const t = tiers.find((x) => x.minTotal > total);
  return t ? { ...t, missing: t.minTotal - total } : null;
}

export type AllocRequest = { id: string; qty: number; at: number; loyalty?: number };
/**
 * Share `supply` packs among requests. Enough supply → everyone gets what they asked.
 *   PRO_RATA: in proportion (rounded down, the remaining packs to the largest remainders, then the earliest);
 *   FIRST_COME: in the order pre-orders came in;
 *   LOYAL_FIRST: the buyers who bought most from this supplier first (then the earliest).
 */
export function allocate(rule: AllocationRule | string, supply: number | null, reqs: AllocRequest[]): Map<string, number> {
  const out = new Map<string, number>();
  const total = reqs.reduce((a, r) => a + r.qty, 0);
  if (supply === null || total <= supply) { for (const r of reqs) out.set(r.id, r.qty); return out; }
  let left = Math.max(0, supply);
  if (rule === "PRO_RATA") {
    const shares = reqs.map((r) => { const exact = (r.qty * left) / total; return { r, base: Math.floor(exact), frac: exact - Math.floor(exact) }; });
    let rest = left - shares.reduce((a, s) => a + s.base, 0);
    for (const s of [...shares].sort((a, b) => b.frac - a.frac || a.r.at - b.r.at)) { if (rest <= 0) break; if (s.base < s.r.qty) { s.base++; rest--; } }
    for (const s of shares) out.set(s.r.id, s.base);
    return out;
  }
  const order = [...reqs].sort(rule === "LOYAL_FIRST" ? (a, b) => (b.loyalty ?? 0) - (a.loyalty ?? 0) || a.at - b.at : (a, b) => a.at - b.at);
  for (const r of order) { const g = Math.min(r.qty, left); out.set(r.id, g); left -= g; }
  return out;
}

/** Deposit for a value (net), rounded to cents. */
export const depositFor = (pct: number, value: number) => (pct > 0 ? r2((value * Math.min(100, pct)) / 100) : 0);

/** Is the campaign taking pre-orders now? */
export const isOpen = (c: { status: string; opensAt: Date; closesAt: Date }, now = new Date()) => c.status === "OPEN" && c.opensAt <= now && c.closesAt > now;

/** Price lock: packs left, value left, what was saved against the list price so far. */
export function lockSums(l: { unitNet: number; listUnitNet: number; qtyTotal: number; qtyTaken: number }) {
  const left = Math.max(0, l.qtyTotal - l.qtyTaken);
  return { left, valueLeft: r2(left * l.unitNet), saved: r2(Math.max(0, l.listUnitNet - l.unitNet) * l.qtyTaken), pctTaken: l.qtyTotal ? Math.round((l.qtyTaken / l.qtyTotal) * 100) : 0 };
}
/** The end of a lock that starts `from` and runs `months`. */
export function lockEnd(from: Date, months: number) {
  const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + months); return d;
}
/** Even call-offs: `left` packs over the months still to go → packs a month. */
export function perMonth(left: number, validUntil: Date | null, now = new Date()) {
  if (!validUntil || left <= 0) return 0;
  const months = Math.max(1, Math.ceil((validUntil.getTime() - now.getTime()) / (30 * 86400_000)));
  return Math.ceil(left / months);
}
