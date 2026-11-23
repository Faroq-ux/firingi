/**
 * Price benchmark — Phase 70. Pure rules shared by server and pages: percentiles over buyers' average prices, a
 * buyer's position in the spread, the most specific group with enough buyers, the yearly saving and the trend.
 *
 * Prices are per base unit (pack price ÷ units in the pack) so different pack sizes of the same product compare;
 * each buyer counts once (its quantity-weighted average), so one big buyer can't move the market.
 */

export type Stats = { buyers: number; p10: number; p25: number; p50: number; p75: number; p90: number; avg: number };

/** Linear-interpolated percentile of a sorted list (p in 0…1). */
export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const r4 = (n: number) => Math.round(n * 10000) / 10000;
export function stats(values: number[]): Stats | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return { buyers: v.length, p10: r4(percentile(v, 0.1)), p25: r4(percentile(v, 0.25)), p50: r4(percentile(v, 0.5)), p75: r4(percentile(v, 0.75)), p90: r4(percentile(v, 0.9)), avg: r4(v.reduce((a, x) => a + x, 0) / v.length) };
}

/**
 * Where a price sits: the share of similar buyers who pay less (0–100), read off the stored percentiles
 * (p10…p90, straight lines in between; below p10 / above p90 scale towards 0 / 100).
 */
export function position(price: number, s: Pick<Stats, "p10" | "p25" | "p50" | "p75" | "p90">) {
  const pts: [number, number][] = [[s.p10, 10], [s.p25, 25], [s.p50, 50], [s.p75, 75], [s.p90, 90]];
  if (price <= s.p10) return s.p10 > 0 ? Math.max(0, Math.round((price / s.p10) * 10)) : 0;
  if (price >= s.p90) return Math.min(100, Math.round(90 + (s.p90 > 0 ? Math.min(10, ((price - s.p90) / s.p90) * 50) : 10)));
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (price <= x1) return Math.round(x1 === x0 ? y1 : y0 + ((price - x0) / (x1 - x0)) * (y1 - y0));
  }
  return 90;
}

/** "Above / around / below" the middle of the market (±3 % of the median is "around"). */
export function band(price: number, median: number): "BELOW" | "AROUND" | "ABOVE" {
  if (median <= 0) return "AROUND";
  const d = (price - median) / median;
  return d > 0.03 ? "ABOVE" : d < -0.03 ? "BELOW" : "AROUND";
}

/** What a buyer could save in a year paying the median (or the given target) for its usual quantity. */
export function yearlySaving(myUnitPrice: number, targetUnitPrice: number, unitsInPeriod: number, periodDays: number) {
  if (!(myUnitPrice > targetUnitPrice) || periodDays <= 0) return 0;
  return Math.round((myUnitPrice - targetUnitPrice) * unitsInPeriod * (365 / periodDays) * 100) / 100;
}

/** Groups from the most specific (same region and kind of business) to the widest (the country). */
export type GroupKey = { regionKey: string; typeKey: string };
export const GROUP_ORDER = (regionId: string | null, businessType: string | null): GroupKey[] => {
  const out: GroupKey[] = [];
  if (regionId && businessType) out.push({ regionKey: regionId, typeKey: businessType });
  if (regionId) out.push({ regionKey: regionId, typeKey: "" });
  if (businessType) out.push({ regionKey: "", typeKey: businessType });
  out.push({ regionKey: "", typeKey: "" });
  return out;
};
export function groupLevel(g: GroupKey): "REGION_TYPE" | "REGION" | "TYPE" | "COUNTRY" {
  return g.regionKey && g.typeKey ? "REGION_TYPE" : g.regionKey ? "REGION" : g.typeKey ? "TYPE" : "COUNTRY";
}

/**
 * The trend warning: my price rose faster than the market's over the window (percentage points), e.g. I went from
 * 2.00 to 2.30 (+15 %) while the market's median went 2.00 → 2.06 (+3 %) → 12 points.
 */
export function riseGap(myFrom: number, myTo: number, mktFrom: number, mktTo: number) {
  if (!(myFrom > 0 && mktFrom > 0)) return 0;
  return Math.round(((myTo / myFrom - 1) - (mktTo / mktFrom - 1)) * 1000) / 10;
}
