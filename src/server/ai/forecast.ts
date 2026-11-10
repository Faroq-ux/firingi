/**
 * Forecasting maths (pure).
 *
 * Demand: Holt's linear smoothing (level + trend) over weekly units, never below zero; a
 * product with fewer than 3 weeks of history gets its average. Stock: days of cover at the
 * recent daily rate. Reorders: the usual gap between a customer's orders.
 */

export function holtForecast(series: number[], ahead: number, alpha = 0.5, beta = 0.3): number[] {
  const xs = series.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  if (!xs.length) return Array(ahead).fill(0);
  if (xs.length < 3) { const avg = xs.reduce((a, v) => a + v, 0) / xs.length; return Array(ahead).fill(round1(avg)); }
  let level = xs[0], trend = xs[1] - xs[0];
  for (let i = 1; i < xs.length; i++) {
    const prev = level;
    level = alpha * xs[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return Array.from({ length: ahead }, (_, h) => round1(Math.max(0, level + (h + 1) * trend)));
}

/** Change of the next weeks against the last weeks (e.g. +0.25 = 25 % more). null when there was nothing before. */
export function trendOf(history: number[], forecast: number[]) {
  const n = Math.min(forecast.length, history.length);
  if (!n) return null;
  const before = history.slice(-n).reduce((a, v) => a + v, 0);
  const after = forecast.slice(0, n).reduce((a, v) => a + v, 0);
  return before > 0 ? Math.round(((after - before) / before) * 100) / 100 : null;
}

export type CoverStatus = "OUT" | "CRITICAL" | "LOW" | "OK" | "NO_SALES";
/** Days the available stock lasts at the daily rate; status by threshold (critical < 7 days, low < 14). */
export function daysOfCover(available: number, dailyRate: number): { days: number | null; status: CoverStatus } {
  if (available <= 0) return { days: 0, status: "OUT" };
  if (dailyRate <= 0) return { days: null, status: "NO_SALES" };
  const days = Math.floor(available / dailyRate);
  return { days, status: days < 7 ? "CRITICAL" : days < 14 ? "LOW" : "OK" };
}

/** Next expected order from past order dates (newest last): median gap, and how overdue it is. */
export function nextOrder(dates: Date[], now = new Date()) {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps = sorted.slice(1).map((d, i) => (d.getTime() - sorted[i].getTime()) / 86400_000).filter((g) => g >= 0.5).slice(-10);
  if (!gaps.length) return null;
  const gap = median(gaps);
  const last = sorted[sorted.length - 1];
  const expected = new Date(last.getTime() + gap * 86400_000);
  const overdueDays = Math.floor((now.getTime() - expected.getTime()) / 86400_000);
  return { gapDays: Math.round(gap * 10) / 10, last, expected, overdueDays, due: overdueDays >= 0 };
}

export function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round1 = (n: number) => Math.round(n * 10) / 10;
