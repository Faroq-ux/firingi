/**
 * Price intelligence maths (Phase 29) — pure, no DB. Market statistics per product, where an offer
 * sits in its market, the price level at a date from a change log, jump detection, and the
 * approval rule for supplier increases.
 */
export type MarketStats = { n: number; min: number; p25: number; median: number; p75: number; max: number; spreadPct: number };
export type Position = "CHEAPEST" | "BELOW_MEDIAN" | "ABOVE_MEDIAN" | "MOST_EXPENSIVE";

export const DEFAULT_SETTINGS = {
  /** increases above this % (vs the current price) wait for FIRINGI; 0 = never */
  approvalThresholdPct: 10,
  /** approved increases apply at least this many days later; customers are told in between */
  noticeDays: 7,
  /** JUMP alert: price up by this % or more … */
  jumpPct: 15,
  /** … within this many days */
  jumpWindowDays: 7,
  /** ABOVE / BELOW_MARKET alert: this far from the market median */
  outlierPct: 30,
  /** markets are compared only with at least this many suppliers (keeps prices anonymous) */
  minSuppliers: 3,
  /** customers who bought the product in this many days are told about an approved increase */
  notifyBuyersDays: 90,
};
export type PriceSettings = typeof DEFAULT_SETTINGS;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Linear-interpolated quantile of an ascending list. */
export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function marketStats(values: number[]): MarketStats | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const median = quantile(v, 0.5);
  return { n: v.length, min: v[0], p25: quantile(v, 0.25), median, p75: quantile(v, 0.75), max: v[v.length - 1], spreadPct: v[0] > 0 ? r2(((v[v.length - 1] - v[0]) / v[0]) * 100) : 0 };
}

export const deviationPct = (value: number, ref: number) => (ref > 0 ? r2(((value - ref) / ref) * 100) : 0);

export function position(value: number, s: MarketStats): Position {
  if (value <= s.p25) return "CHEAPEST";
  if (value >= s.p75 && value > s.median) return "MOST_EXPENSIVE";
  return value <= s.median ? "BELOW_MEDIAN" : "ABOVE_MEDIAN";
}

export type Change = { changedAt: Date; newPrice: number | null };

/** Price in force at a moment, from a change log (null = no price then). */
export function levelAt(changes: Change[], at: Date): number | null {
  let level: number | null = null;
  for (const c of [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())) {
    if (c.changedAt.getTime() > at.getTime()) break;
    level = c.newPrice;
  }
  return level;
}

/** Did the price rise by `pct` % or more within the last `days` days? (compares with the lowest level in the window) */
export function jump(changes: Change[], now: Date, days: number, pct: number): { from: number; to: number; pct: number } | null {
  const start = new Date(now.getTime() - days * 86_400_000);
  const current = levelAt(changes, now);
  if (current === null) return null;
  const levels = [levelAt(changes, start), ...changes.filter((c) => c.changedAt > start && c.changedAt <= now).map((c) => c.newPrice)].filter((x): x is number => x !== null && x > 0);
  if (!levels.length) return null;
  const low = Math.min(...levels);
  const up = deviationPct(current, low);
  return up >= pct ? { from: low, to: current, pct: up } : null;
}

/** Must FIRINGI approve this change first? Only increases above the threshold of an existing price. */
export function needsApproval(oldPrice: number | null, newPrice: number, thresholdPct: number) {
  if (!thresholdPct || oldPrice === null || oldPrice <= 0) return false;
  return deviationPct(newPrice, oldPrice) > thresholdPct;
}

/** Step series for a chart: one point per change, plus "now" so the last level is drawn to the right edge. */
export function stepSeries(changes: Change[], from: Date, now: Date, divisor = 1) {
  const sorted = [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const start = levelAt(sorted, from);
  const pts: { t: number; v: number | null }[] = [{ t: from.getTime(), v: start === null ? null : r4(start / divisor) }];
  for (const c of sorted) if (c.changedAt > from && c.changedAt <= now) pts.push({ t: c.changedAt.getTime(), v: c.newPrice === null ? null : r4(c.newPrice / divisor) });
  const last = levelAt(sorted, now);
  pts.push({ t: now.getTime(), v: last === null ? null : r4(last / divisor) });
  return pts;
}
const r4 = (v: number) => Math.round(v * 10000) / 10000;
