/**
 * Demand planning maths (Phase 30) — pure, no database.
 *
 * Forecast: weekly units of one product in one warehouse. Several methods compete in a rolling
 * one-week-ahead back-test over the last weeks; the one with the lowest mean absolute error wins
 * (ties go to the simpler method). Event weeks (holidays, promotions) are taken out of the history
 * before fitting and put back into the forecast.
 *
 * Restock: periodic review, order-up-to policy.
 *   safety stock  = z(service level) × σ(week) × √((lead time + review) / 7)
 *   reorder point = demand during the lead time + safety stock       (or the manual one, if higher)
 *   order-up-to   = demand during lead time + review period + safety stock
 *   order         = order-up-to − (usable + incoming), up to the pack multiple, at least the minimum
 */

export type Method = "AVERAGE" | "HOLT" | "CROSTON" | "SEASONAL";
export const DAY = 86_400_000;

// ── dates ───────────────────────────────────────────────────────────────────

/** Monday 00:00 UTC of the week of `d`. */
export function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// ── small stats ─────────────────────────────────────────────────────────────

const sum = (xs: number[]) => xs.reduce((a, v) => a + v, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Standard normal quantile (Acklam's rational approximation, |error| < 1.2e-9). */
export function zFor(p: number): number {
  const q = Math.min(0.9999, Math.max(0.5, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (q > 0.97575) {
    const t = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  const t = q - 0.5, r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ── forecasting methods (each: history → next `ahead` weeks) ───────────────

export function average(h: number[], ahead: number) {
  const w = h.slice(-8);
  return Array(ahead).fill(Math.max(0, mean(w)));
}

/** Holt's linear smoothing with a damped trend (φ = 0.9) — trends fade instead of running away. */
export function holtDamped(h: number[], ahead: number, alpha = 0.4, beta = 0.15, phi = 0.9) {
  if (h.length < 3) return average(h, ahead);
  let level = h[0], trend = (h[Math.min(3, h.length - 1)] - h[0]) / Math.min(3, h.length - 1);
  for (let i = 1; i < h.length; i++) {
    const prev = level;
    level = alpha * h[i] + (1 - alpha) * (prev + phi * trend);
    trend = beta * (level - prev) + (1 - beta) * phi * trend;
  }
  const out: number[] = [];
  let damp = 0;
  for (let k = 1; k <= ahead; k++) { damp += phi ** k; out.push(Math.max(0, level + damp * trend)); }
  return out;
}

/** Holt with the smoothing weights that fit this history best (smallest one-step squared error). */
export function holtAuto(h: number[], ahead: number) {
  if (h.length < 6) return holtDamped(h, ahead);
  let best = { a: 0.4, b: 0.15, sse: Infinity };
  for (const a of [0.2, 0.4, 0.6, 0.8]) for (const b of [0.05, 0.15, 0.3]) {
    let sse = 0;
    for (let t = 3; t < h.length; t++) sse += (h[t] - holtDamped(h.slice(0, t), 1, a, b)[0]) ** 2;
    if (sse < best.sse) best = { a, b, sse };
  }
  return holtDamped(h, ahead, best.a, best.b);
}

/** Croston with the Syntetos–Boylan correction — for products that sell in some weeks only. */
export function croston(h: number[], ahead: number, alpha = 0.2) {
  const first = h.findIndex((v) => v > 0);
  if (first < 0) return Array(ahead).fill(0);
  let z = h[first], p = first + 1, gap = 1;
  for (let i = first + 1; i < h.length; i++) {
    if (h[i] > 0) { z = alpha * h[i] + (1 - alpha) * z; p = alpha * gap + (1 - alpha) * p; gap = 1; } else gap++;
  }
  return Array(ahead).fill(Math.max(0, (1 - alpha / 2) * (z / p)));
}

/** Same weeks last year, scaled by how this year's last 8 weeks compare with last year's. */
export function seasonal(h: number[], ahead: number) {
  if (h.length < 60) return average(h, ahead);
  const n = h.length;
  const recent = mean(h.slice(-8)), lastYear = mean(h.slice(n - 52 - 8, n - 52));
  const k = lastYear > 0 ? Math.min(3, Math.max(0.33, recent / lastYear)) : 1;
  return Array.from({ length: ahead }, (_, i) => Math.max(0, (h[n - 52 + i] ?? recent) * k));
}

const METHODS: Record<Method, (h: number[], ahead: number) => number[]> = { AVERAGE: average, HOLT: holtAuto, CROSTON: croston, SEASONAL: seasonal };

/** Share of weeks without sales since the first sale. */
export function zeroShare(h: number[]) {
  const first = h.findIndex((v) => v > 0);
  if (first < 0) return 1;
  const s = h.slice(first);
  return s.filter((v) => v === 0).length / s.length;
}

export type Fit = {
  method: Method; forecast: number[]; low: number[]; high: number[]; sigma: number;
  /** one-week-ahead mean absolute error of each method in the back-test */
  scores: Partial<Record<Method, number>>; weeksOfHistory: number; intermittent: boolean;
};

/**
 * Pick the best method for this history and forecast `ahead` weeks with an 80 % range.
 * `history` is weekly units, oldest first, with event effects already taken out.
 */
export function fit(history: number[], ahead: number): Fit {
  const first = history.findIndex((v) => v > 0);
  const h = first < 0 ? [] : history.slice(first).map((v) => Math.max(0, Number.isFinite(v) ? v : 0));
  const weeks = h.length;
  if (weeks === 0) return { method: "AVERAGE", forecast: Array(ahead).fill(0), low: Array(ahead).fill(0), high: Array(ahead).fill(0), sigma: 0, scores: {}, weeksOfHistory: 0, intermittent: false };
  const intermittent = weeks >= 6 && zeroShare(h) >= 0.4;
  const candidates: Method[] = ["AVERAGE"];
  if (weeks >= 6) candidates.push("HOLT");
  if (intermittent) candidates.push("CROSTON");
  if (weeks >= 60) candidates.push("SEASONAL");
  const tests = Math.min(8, weeks - 4);
  const scores: Partial<Record<Method, number>> = {};
  const errors: Partial<Record<Method, number[]>> = {};
  if (tests >= 2) {
    for (const m of candidates) {
      const e: number[] = [];
      for (let t = weeks - tests; t < weeks; t++) e.push(h[t] - METHODS[m](h.slice(0, t), 1)[0]);
      errors[m] = e;
      scores[m] = r2(mean(e.map(Math.abs)));
    }
  }
  let method: Method = "AVERAGE";
  for (const m of candidates) if ((scores[m] ?? Infinity) < (scores[method] ?? Infinity) - 1e-9) method = m;
  const forecast = METHODS[method](h, ahead).map(r2);
  // spread: RMSE of the winner's back-test errors; at least a Poisson-like √mean so safety stock is never zero
  const e = errors[method];
  const rmse = e && e.length ? Math.sqrt(mean(e.map((x) => x * x))) : Math.sqrt(mean(h.map((v) => (v - mean(h)) ** 2)));
  const sigma = r2(Math.max(rmse, Math.sqrt(Math.max(0, mean(h.slice(-8))))));
  const z80 = 1.2816;
  return {
    method, forecast, sigma, scores, weeksOfHistory: weeks, intermittent,
    low: forecast.map((f, i) => r2(Math.max(0, f - z80 * sigma * Math.sqrt(i + 1)))),
    high: forecast.map((f, i) => r2(f + z80 * sigma * Math.sqrt(i + 1))),
  };
}

// ── events ──────────────────────────────────────────────────────────────────

export type EventSpan = { startsOn: Date; endsOn: Date; upliftPct: number };

/** Demand multiplier for the week starting `monday`: each event weighs by the days it covers. */
export function eventFactor(events: EventSpan[], monday: Date): number {
  let f = 1;
  const end = addDays(monday, 7);
  for (const e of events) {
    const from = Math.max(e.startsOn.getTime(), monday.getTime());
    const to = Math.min(addDays(startOfDay(e.endsOn), 1).getTime(), end.getTime());
    if (to <= from) continue;
    f *= 1 + (e.upliftPct / 100) * ((to - from) / (7 * DAY));
  }
  return Math.max(0.05, f);
}

/** Take event effects out of past weeks (`weeks[i]` starts on `mondays[i]`). */
export const cleanHistory = (weeks: number[], mondays: Date[], events: EventSpan[]) => weeks.map((v, i) => v / eventFactor(events, mondays[i]));

/** Weekly forecast with events put back in. */
export const withEvents = (weeks: number[], mondays: Date[], events: EventSpan[]) => weeks.map((v, i) => r2(v * eventFactor(events, mondays[i])));

// ── the restock plan ───────────────────────────────────────────────────────

/** Units expected over the next `days` days, walking the weekly forecast (the last week repeats). */
export function demandOver(weekly: number[], days: number): number {
  if (days <= 0 || !weekly.length) return 0;
  let left = days, total = 0, i = 0;
  while (left > 0) {
    const w = weekly[Math.min(i, weekly.length - 1)];
    const d = Math.min(7, left);
    total += (w / 7) * d;
    left -= d; i++;
  }
  return total;
}

/** Days until `units` are sold at the forecast (null = not within a year). */
export function daysUntilSold(weekly: number[], units: number): number | null {
  if (units <= 0) return 0;
  let left = units;
  for (let day = 0; day < 366; day++) {
    const w = weekly[Math.min(Math.floor(day / 7), weekly.length - 1)] ?? 0;
    left -= w / 7;
    if (left <= 1e-9) return day + 1;
  }
  return null;
}

export type Urgency = "OUT" | "LATE" | "ORDER_NOW" | "SOON";
export type PlanInput = {
  weekly: number[]; sigma: number; leadTimeDays: number; reviewDays: number; serviceLevel: number;
  usable: number; incoming: number; minOrderQty?: number; packMultiple?: number; manualReorderPoint?: number | null; manualReorderQty?: number | null;
};
export type Plan = {
  dailyDemand: number; safetyStock: number; reorderPoint: number; orderUpTo: number; position: number;
  qty: number; urgency: Urgency | null; coverDays: number | null; runsOutInDays: number | null; orderInDays: number | null;
};

export function plan(i: PlanInput): Plan {
  const L = Math.max(0, i.leadTimeDays), R = Math.max(1, i.reviewDays);
  const dailyDemand = r2(demandOver(i.weekly, 28) / 28);
  const z = zFor(i.serviceLevel / 100);
  const safetyStock = dailyDemand > 0 ? Math.ceil(z * i.sigma * Math.sqrt((L + R) / 7)) : 0;
  let reorderPoint = Math.ceil(demandOver(i.weekly, L) + safetyStock);
  let orderUpTo = Math.ceil(demandOver(i.weekly, L + R) + safetyStock);
  if (i.manualReorderPoint != null && i.manualReorderPoint > reorderPoint) {
    orderUpTo += i.manualReorderPoint - reorderPoint;
    reorderPoint = i.manualReorderPoint;
  }
  const position = i.usable + i.incoming;
  const runsOutInDays = dailyDemand > 0 ? daysUntilSold(i.weekly, i.usable) : null;
  const coverDays = dailyDemand > 0 ? daysUntilSold(i.weekly, position) : null;
  let urgency: Urgency | null = null;
  if (dailyDemand > 0 || (i.manualReorderPoint != null && position <= i.manualReorderPoint)) {
    if (i.usable <= 0 && dailyDemand > 0 && i.incoming <= 0) urgency = "OUT";
    else if (runsOutInDays !== null && runsOutInDays < L && position < Math.ceil(demandOver(i.weekly, L))) urgency = "LATE";
    else if (position <= reorderPoint) urgency = i.usable <= 0 && dailyDemand > 0 ? "OUT" : "ORDER_NOW";
    // "order soon" only when nothing is already on order: goods on the way cover the review period, and a
    // small rise in the forecast right after ordering must not ask for a top-up (the next review checks again)
    else if (i.incoming <= 0 && position - demandOver(i.weekly, R) <= reorderPoint) urgency = "SOON";
  }
  let qty = 0;
  if (urgency) {
    qty = Math.max(0, orderUpTo - position);
    if (dailyDemand === 0) qty = i.manualReorderQty ?? Math.max(1, (i.manualReorderPoint ?? 0) * 2 - position);
    const mult = Math.max(1, i.packMultiple ?? 1);
    qty = Math.ceil(qty / mult) * mult;
    if (qty > 0) qty = Math.max(qty, i.minOrderQty ?? 1);
    if (qty <= 0) urgency = null;
  }
  // order by: the day the stock position reaches the reorder point
  const orderInDays = urgency === "SOON" && dailyDemand > 0 ? Math.max(0, Math.floor((position - reorderPoint) / dailyDemand)) : urgency ? 0 : null;
  return { dailyDemand, safetyStock, reorderPoint, orderUpTo, position, qty, urgency, coverDays, runsOutInDays, orderInDays };
}

// ── supplier lead times ─────────────────────────────────────────────────────

export type LeadSample = { sentAt: Date; receivedAt: Date | null; expectedOn: Date | null; ordered: number; received: number };
export type LeadStats = { orders: number; measured: number | null; p90: number | null; onTimePct: number | null; fillPct: number | null };

/** Days from sending to the first goods receipt; on time = received by the expected date. */
export function leadStats(samples: LeadSample[]): LeadStats {
  const done = samples.filter((s) => s.receivedAt);
  if (!done.length) return { orders: 0, measured: null, p90: null, onTimePct: null, fillPct: null };
  const days = done.map((s) => Math.max(0, (s.receivedAt!.getTime() - s.sentAt.getTime()) / DAY)).sort((a, b) => a - b);
  const q = (p: number) => days[Math.min(days.length - 1, Math.max(0, Math.ceil(p * days.length) - 1))];
  const withDate = done.filter((s) => s.expectedOn);
  const onTime = withDate.filter((s) => startOfDay(s.receivedAt!).getTime() <= startOfDay(s.expectedOn!).getTime()).length;
  const ordered = sum(done.map((s) => s.ordered));
  return {
    orders: done.length,
    measured: Math.round(q(0.5) * 10) / 10,
    p90: Math.round(q(0.9) * 10) / 10,
    onTimePct: withDate.length ? Math.round((onTime / withDate.length) * 100) : null,
    fillPct: ordered > 0 ? Math.round((sum(done.map((s) => s.received)) / ordered) * 100) : null,
  };
}

/** Lead time to plan with: measured (rounded up) when there are ≥ 3 receipts and it is allowed, else the stated one. */
export const leadTimeToUse = (stated: number, s: LeadStats, useMeasured: boolean) =>
  useMeasured && s.orders >= 3 && s.measured !== null ? { days: Math.ceil(s.measured), source: "MEASURED" as const } : { days: stated, source: "STATED" as const };

// ── accuracy ────────────────────────────────────────────────────────────────

/** WAPE (Σ|actual − forecast| / Σ actual), accuracy = 1 − WAPE (never below 0), bias = Σ(f − a) / Σ a. */
export function accuracy(rows: { qty: number; actual: number }[]) {
  const a = sum(rows.map((r) => r.actual));
  if (!rows.length) return { weeks: 0, wape: null, accuracyPct: null, biasPct: null };
  if (a <= 0) return { weeks: rows.length, wape: null, accuracyPct: null, biasPct: null };
  const wape = sum(rows.map((r) => Math.abs(r.actual - r.qty))) / a;
  return { weeks: rows.length, wape: r2(wape), accuracyPct: Math.max(0, Math.round((1 - wape) * 100)), biasPct: Math.round((sum(rows.map((r) => r.qty - r.actual)) / a) * 100) };
}

// ── overstock & expiry risk ────────────────────────────────────────────────

export type BatchIn = { id: string; free: number; daysLeft: number | null };
/**
 * First-expiry-first-out projection: how many units of each batch will still be unsold when it
 * expires at the forecast pace. Batches without a best-before are never at risk.
 */
export function expiryRisk(batches: BatchIn[], weekly: number[]): { id: string; sells: number; atRisk: number }[] {
  const sorted = [...batches].sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  let used = 0;
  return sorted.map((b) => {
    if (b.daysLeft === null) return { id: b.id, sells: b.free, atRisk: 0 };
    const capacity = Math.max(0, Math.floor(demandOver(weekly, Math.max(0, b.daysLeft)) + 1e-9) - used);
    const sells = Math.min(b.free, capacity);
    used += sells;
    return { id: b.id, sells, atRisk: Math.max(0, b.free - sells) };
  });
}

/** Units beyond `overstockDays` of cover (0 when not overstocked or nothing sells — then all of it is slow). */
export function overstock(usable: number, weekly: number[], overstockDays: number) {
  const daily = demandOver(weekly, 28) / 28;
  if (usable <= 0) return { excess: 0, coverDays: 0, noSales: false };
  if (daily <= 0) return { excess: usable, coverDays: null, noSales: true };
  const keep = Math.ceil(demandOver(weekly, overstockDays));
  const coverDays = daysUntilSold(weekly, usable);
  return { excess: Math.max(0, usable - keep), coverDays, noSales: false };
}

/** Discount to suggest for stock that won't sell in time (deeper when closer to the date). */
export const markdownPct = (daysLeft: number) => (daysLeft <= 3 ? 40 : daysLeft <= 7 ? 25 : daysLeft <= 14 ? 15 : 10);

/** Weekday shares (Mon…Sun, sum 1) from units per weekday. */
export function weekdayProfile(units: number[]) {
  const t = sum(units);
  return units.map((u) => (t > 0 ? Math.round((u / t) * 1000) / 1000 : 0));
}
