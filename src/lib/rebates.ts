/**
 * Phase 48 — rebates & bonuses (pure). A supplier (or FIRINGI) runs deals for its customers over periods:
 *   VOLUME      money back once the period's purchases pass a target; tiers (2 % / 3 % / 4 %); "retro" pays the
 *               reached tier's % on the whole period, otherwise only on the part above each threshold
 *   FREE_GOODS  buy X units of the deal's products in the period → Y units of a product free (on a later order)
 *   GROWTH      a % when the customer buys more than in the same period a year before (on the increase, or the total)
 *   MIX         buy at least N different products of a set (each at least q units) → a fixed amount or a %
 * Purchases count delivered goods net of returns / credit notes, excluding VAT, per company or per shop.
 */
export const REBATE_KINDS = ["VOLUME", "FREE_GOODS", "GROWTH", "MIX"] as const;
export type RebateKind = (typeof REBATE_KINDS)[number];
export const REBATE_PERIODS = ["MONTH", "QUARTER", "HALF_YEAR", "YEAR"] as const;
export type RebatePeriod = (typeof REBATE_PERIODS)[number];
export type Basis = "AMOUNT" | "UNITS";

export type Tier = { from: number; pct: number };
export type RebateRules =
  | { kind: "VOLUME"; basis: Basis; tiers: Tier[]; retro: boolean }
  | { kind: "FREE_GOODS"; buyUnits: number; freeUnits: number; maxFreePerPeriod: number | null }
  | { kind: "GROWTH"; tiers: { growthPct: number; pct: number }[]; base: "INCREASE" | "TOTAL"; minPrevious: number }
  | { kind: "MIX"; minDistinct: number; minUnitsEach: number; rewardFixed: number | null; rewardPct: number | null };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The calendar period containing `d` (UTC): key like 2026-M11, 2026-Q4, 2026-H2, 2026. */
export function periodOf(d: Date, p: RebatePeriod): { key: string; start: Date; end: Date } {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const span = p === "MONTH" ? 1 : p === "QUARTER" ? 3 : p === "HALF_YEAR" ? 6 : 12;
  const first = Math.floor(m / span) * span;
  const start = new Date(Date.UTC(y, first, 1));
  const end = new Date(Date.UTC(y, first + span, 1)); // exclusive
  const key = p === "MONTH" ? `${y}-M${String(first + 1).padStart(2, "0")}` : p === "QUARTER" ? `${y}-Q${first / 3 + 1}` : p === "HALF_YEAR" ? `${y}-H${first / 6 + 1}` : `${y}`;
  return { key, start, end };
}

/** The same period one year earlier (growth bonus). */
export function previousYear(period: { start: Date; end: Date }) {
  const back = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
  return { start: back(period.start), end: back(period.end) };
}

/** Periods of a deal that have ended by `now` (start within the deal's dates) — the ones to settle. */
export function endedPeriods(p: RebatePeriod, validFrom: Date, validTo: Date | null, now: Date) {
  const out: { key: string; start: Date; end: Date }[] = [];
  let cur = periodOf(validFrom, p);
  for (let i = 0; i < 400 && cur.end <= now; i++) {
    if (!validTo || cur.start < validTo) out.push(cur);
    cur = periodOf(cur.end, p);
  }
  return out;
}

export function sortedTiers<T extends { pct: number }>(tiers: T[], key: (t: T) => number) {
  return [...tiers].filter((t) => t.pct >= 0 && key(t) >= 0).sort((a, b) => key(a) - key(b));
}

export type Stats = { amount: number; units: number; previousAmount: number; distinct: number; perProductUnits: Record<string, number> };
export type Result = {
  /** money earned so far (credit note at period end) */
  value: number;
  /** free units earned so far */
  freeUnits: number;
  /** the % reached (volume / growth) */
  pct: number;
  /** what is still missing for the next step (amount, units, growth %, products), and what it brings */
  next: { missing: number; unit: "AMOUNT" | "UNITS" | "GROWTH_PCT" | "PRODUCTS"; pct?: number; freeUnits?: number; reward?: number } | null;
  /** 0–100, for the progress bar (towards the next step, or 100 when the top is reached) */
  progress: number;
};

export function evaluate(rules: RebateRules, s: Stats): Result {
  if (rules.kind === "VOLUME") {
    const v = rules.basis === "AMOUNT" ? s.amount : s.units;
    const tiers = sortedTiers(rules.tiers, (t) => t.from);
    const reached = tiers.filter((t) => v >= t.from);
    const top = reached[reached.length - 1];
    let value = 0;
    if (top) {
      if (rules.retro) value = s.amount * top.pct / 100; // money back is always on the amount bought
      else {
        // incremental: each tier's % on the part between its threshold and the next one (money measured on amount)
        const ratio = v > 0 ? s.amount / v : 0;
        for (let i = 0; i < reached.length; i++) {
          const lo = reached[i].from, hi = i + 1 < tiers.length ? Math.min(v, tiers[i + 1].from) : v;
          value += Math.max(0, hi - lo) * ratio * reached[i].pct / 100;
        }
      }
    }
    const nextTier = tiers.find((t) => v < t.from);
    const prevFrom = top?.from ?? 0;
    return {
      value: r2(value), freeUnits: 0, pct: top?.pct ?? 0,
      next: nextTier ? { missing: r2(nextTier.from - v), unit: rules.basis === "AMOUNT" ? "AMOUNT" : "UNITS", pct: nextTier.pct } : null,
      progress: nextTier ? Math.max(0, Math.min(100, Math.round(((v - prevFrom) / Math.max(1e-9, nextTier.from - prevFrom)) * 100))) : 100,
    };
  }
  if (rules.kind === "FREE_GOODS") {
    const times = rules.buyUnits > 0 ? Math.floor(s.units / rules.buyUnits) : 0;
    let free = times * rules.freeUnits;
    if (rules.maxFreePerPeriod != null) free = Math.min(free, rules.maxFreePerPeriod);
    const capped = rules.maxFreePerPeriod != null && free >= rules.maxFreePerPeriod;
    const missing = capped || rules.buyUnits <= 0 ? 0 : rules.buyUnits - (s.units % rules.buyUnits);
    return {
      value: 0, freeUnits: free, pct: 0,
      next: capped || rules.buyUnits <= 0 ? null : { missing, unit: "UNITS", freeUnits: rules.freeUnits },
      progress: capped ? 100 : rules.buyUnits > 0 ? Math.round(((s.units % rules.buyUnits) / rules.buyUnits) * 100) : 0,
    };
  }
  if (rules.kind === "GROWTH") {
    const prev = s.previousAmount;
    if (prev < Math.max(0.01, rules.minPrevious)) return { value: 0, freeUnits: 0, pct: 0, next: null, progress: 0 };
    const growth = ((s.amount - prev) / prev) * 100;
    const tiers = sortedTiers(rules.tiers, (t) => t.growthPct);
    const reached = tiers.filter((t) => growth >= t.growthPct);
    const top = reached[reached.length - 1];
    const baseAmount = rules.base === "TOTAL" ? s.amount : Math.max(0, s.amount - prev);
    const nextTier = tiers.find((t) => growth < t.growthPct);
    // money still needed to reach the next growth step
    const missing = nextTier ? r2(prev * (1 + nextTier.growthPct / 100) - s.amount) : 0;
    const lo = top?.growthPct ?? 0, g = Math.max(0, growth);
    return {
      value: r2(top ? baseAmount * top.pct / 100 : 0), freeUnits: 0, pct: top?.pct ?? 0,
      next: nextTier ? { missing, unit: "AMOUNT", pct: nextTier.pct } : null,
      progress: nextTier ? Math.max(0, Math.min(100, Math.round(((g - lo) / Math.max(1e-9, nextTier.growthPct - lo)) * 100))) : 100,
    };
  }
  // MIX
  const counted = Object.values(s.perProductUnits).filter((u) => u >= Math.max(1, rules.minUnitsEach)).length;
  const met = counted >= rules.minDistinct;
  const reward = met ? r2((rules.rewardFixed ?? 0) + (rules.rewardPct ? s.amount * rules.rewardPct / 100 : 0)) : 0;
  return {
    value: reward, freeUnits: 0, pct: met ? rules.rewardPct ?? 0 : 0,
    next: met ? null : { missing: rules.minDistinct - counted, unit: "PRODUCTS", reward: rules.rewardFixed ?? undefined, pct: rules.rewardPct ?? undefined },
    progress: Math.min(100, Math.round((counted / Math.max(1, rules.minDistinct)) * 100)),
  };
}

/** Check and normalise a deal's rules (supplier form / API); throws a readable message. */
export function cleanRules(raw: unknown): RebateRules {
  const v = (raw ?? {}) as Record<string, unknown>;
  const num = (x: unknown, min = 0) => { const n = Number(x); if (!Number.isFinite(n) || n < min) throw new Error("Check the numbers of the deal."); return n; };
  const kind = String(v.kind) as RebateKind;
  if (kind === "VOLUME") {
    const tiers = (Array.isArray(v.tiers) ? v.tiers : []).map((t: { from?: unknown; pct?: unknown }) => ({ from: num(t.from), pct: num(t.pct) }));
    if (!tiers.length || tiers.some((t) => t.pct <= 0 || t.pct > 50)) throw new Error("Give at least one step: a target and a % (up to 50 %).");
    if (new Set(tiers.map((t) => t.from)).size !== tiers.length) throw new Error("Each step needs its own target.");
    return { kind, basis: v.basis === "UNITS" ? "UNITS" : "AMOUNT", tiers: sortedTiers(tiers, (t) => t.from), retro: v.retro !== false };
  }
  if (kind === "FREE_GOODS") {
    const buyUnits = num(v.buyUnits, 1), freeUnits = num(v.freeUnits, 1);
    if (!Number.isInteger(buyUnits) || !Number.isInteger(freeUnits)) throw new Error("Units are whole numbers.");
    const max = v.maxFreePerPeriod == null || v.maxFreePerPeriod === "" ? null : num(v.maxFreePerPeriod, 1);
    return { kind, buyUnits, freeUnits, maxFreePerPeriod: max };
  }
  if (kind === "GROWTH") {
    const tiers = (Array.isArray(v.tiers) ? v.tiers : []).map((t: { growthPct?: unknown; pct?: unknown }) => ({ growthPct: num(t.growthPct), pct: num(t.pct) }));
    if (!tiers.length || tiers.some((t) => t.pct <= 0 || t.pct > 50)) throw new Error("Give at least one step: a growth % and a bonus % (up to 50 %).");
    return { kind, tiers: sortedTiers(tiers, (t) => t.growthPct), base: v.base === "TOTAL" ? "TOTAL" : "INCREASE", minPrevious: v.minPrevious == null ? 0 : num(v.minPrevious) };
  }
  if (kind === "MIX") {
    const minDistinct = num(v.minDistinct, 1);
    const rewardFixed = v.rewardFixed == null || v.rewardFixed === "" ? null : num(v.rewardFixed);
    const rewardPct = v.rewardPct == null || v.rewardPct === "" ? null : num(v.rewardPct);
    if (!rewardFixed && !rewardPct) throw new Error("Give the bonus: a fixed amount, a %, or both.");
    if (rewardPct && rewardPct > 50) throw new Error("The bonus % is at most 50 %.");
    return { kind, minDistinct: Math.round(minDistinct), minUnitsEach: v.minUnitsEach == null ? 1 : Math.max(1, Math.round(num(v.minUnitsEach))), rewardFixed, rewardPct };
  }
  throw new Error("Choose the kind of deal.");
}

// ── FIRINGI's switches (Admin › Pricing › Rebates & Bonuses) ────────────────

export const REBATE_AUDIENCES = ["ALL", "SEGMENT", "GROUP", "COMPANIES", "BUYING_GROUP"] as const;
export type RebateAudience = (typeof REBATE_AUDIENCES)[number];

export type RebateSettings = {
  /** the whole feature */
  enabled: boolean;
  kinds: Record<RebateKind, boolean>;
  periods: Record<RebatePeriod, boolean>;
  /** who a deal may be for; COUNTRY = limit to buyer countries; PER_SHOP = count each shop on its own */
  audiences: Record<RebateAudience | "COUNTRY" | "PER_SHOP", boolean>;
  /** which suppliers may create deals (one supplier can be switched on / off on its own) */
  creators: { DISTRIBUTOR: boolean; WHOLESALER: boolean };
  /** which buyers can earn */
  buyers: { CUSTOMER: boolean; WHOLESALER: boolean };
  /** ALWAYS = FIRINGI approves every deal; AUTO = deals within the limits start by themselves */
  approval: "ALWAYS" | "AUTO";
  /** FIRINGI may run deals it pays for itself */
  firingiFunded: boolean;
  /** the highest % any step may give */
  maxPct: number;
  /** the highest fixed bonus (product mix) */
  maxFixed: number;
  /** default days a customer has to take free goods */
  freeGoodsDays: number;
  /** days after a period ends before it is settled (late deliveries and returns count) */
  settleDelayDays: number;
  /** remind customers near the next step in the last days of a period */
  nudge: boolean;
  nudgeDays: number;
};

export const DEFAULT_REBATE_SETTINGS: RebateSettings = {
  enabled: true,
  kinds: { VOLUME: true, FREE_GOODS: true, GROWTH: true, MIX: true },
  periods: { MONTH: true, QUARTER: true, HALF_YEAR: true, YEAR: true },
  audiences: { ALL: true, SEGMENT: true, GROUP: true, COMPANIES: true, BUYING_GROUP: true, COUNTRY: true, PER_SHOP: true },
  creators: { DISTRIBUTOR: true, WHOLESALER: true },
  buyers: { CUSTOMER: true, WHOLESALER: true },
  approval: "ALWAYS",
  firingiFunded: true,
  maxPct: 15,
  maxFixed: 5000,
  freeGoodsDays: 60,
  settleDelayDays: 3,
  nudge: true,
  nudgeDays: 7,
};

export function mergeRebateSettings(v: Partial<RebateSettings> | null | undefined): RebateSettings {
  const d = DEFAULT_REBATE_SETTINGS;
  const x = v ?? {};
  return {
    ...d, ...x,
    kinds: { ...d.kinds, ...(x.kinds ?? {}) }, periods: { ...d.periods, ...(x.periods ?? {}) }, audiences: { ...d.audiences, ...(x.audiences ?? {}) },
    creators: { ...d.creators, ...(x.creators ?? {}) }, buyers: { ...d.buyers, ...(x.buyers ?? {}) },
  };
}

/** Check FIRINGI's settings form; throws a readable message. */
export function cleanRebateSettings(input: RebateSettings): RebateSettings {
  const n = (x: unknown, lo: number, hi: number, label: string) => { const v = Number(x); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`); return v; };
  const bools = <K extends string>(keys: readonly K[], o: Record<string, unknown> | undefined) => Object.fromEntries(keys.map((k) => [k, !!o?.[k]])) as Record<K, boolean>;
  return {
    enabled: !!input.enabled,
    kinds: bools(REBATE_KINDS, input.kinds), periods: bools(REBATE_PERIODS, input.periods),
    audiences: bools([...REBATE_AUDIENCES, "COUNTRY", "PER_SHOP"] as const, input.audiences),
    creators: bools(["DISTRIBUTOR", "WHOLESALER"] as const, input.creators), buyers: bools(["CUSTOMER", "WHOLESALER"] as const, input.buyers),
    approval: input.approval === "AUTO" ? "AUTO" : "ALWAYS",
    firingiFunded: !!input.firingiFunded,
    maxPct: n(input.maxPct, 0.5, 50, "The highest %"),
    maxFixed: n(input.maxFixed, 0, 1_000_000, "The highest fixed bonus"),
    freeGoodsDays: Math.round(n(input.freeGoodsDays, 7, 365, "Days to take free goods")),
    settleDelayDays: Math.round(n(input.settleDelayDays, 0, 30, "Days before a period is settled")),
    nudge: !!input.nudge,
    nudgeDays: Math.round(n(input.nudgeDays, 1, 31, "Reminder days")),
  };
}

/** The deal's rules break FIRINGI's limits? (message) — checked on save and again on approval. */
export function limitProblem(rules: RebateRules, s: RebateSettings): string | null {
  const pcts = rules.kind === "VOLUME" || rules.kind === "GROWTH" ? rules.tiers.map((t) => t.pct) : rules.kind === "MIX" && rules.rewardPct ? [rules.rewardPct] : [];
  if (pcts.some((p) => p > s.maxPct)) return `A step gives more than ${s.maxPct} %, the most FIRINGI allows.`;
  if (rules.kind === "MIX" && (rules.rewardFixed ?? 0) > s.maxFixed) return `The fixed bonus is more than ${s.maxFixed}, the most FIRINGI allows.`;
  return null;
}

/** Share `total` over parts in proportion to their weights, to the cent; the last part takes the rounding. */
export function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const out: number[] = [];
  let given = 0;
  const last = weights.reduce((li, w, i) => (w > 0 ? i : li), -1);
  weights.forEach((w, i) => {
    if (w <= 0) return out.push(0);
    const v = i === last ? r2(total - given) : r2((total * w) / sum);
    given = r2(given + v);
    out.push(v);
  });
  return out;
}
