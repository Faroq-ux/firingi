/** Phase 48: rebate & bonus rules (pure) — periods, the four kinds, rule checks, FIRINGI's settings, spreading money. */
import { describe, expect, it } from "vitest";
import {
  cleanRebateSettings, cleanRules, DEFAULT_REBATE_SETTINGS, endedPeriods, evaluate, limitProblem, mergeRebateSettings, periodOf, previousYear, spread, type Stats,
} from "@/lib/rebates";

const S = (p: Partial<Stats> = {}): Stats => ({ amount: 0, units: 0, previousAmount: 0, distinct: 0, perProductUnits: {}, ...p });
const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("periods", () => {
  it("keys and bounds (UTC, end exclusive)", () => {
    expect(periodOf(d("2026-11-19"), "MONTH")).toEqual({ key: "2026-M11", start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") });
    expect(periodOf(d("2026-11-19"), "QUARTER").key).toBe("2026-Q4");
    expect(periodOf(d("2026-02-01"), "HALF_YEAR")).toMatchObject({ key: "2026-H1", end: new Date("2026-07-01T00:00:00Z") });
    expect(periodOf(d("2026-12-31"), "YEAR")).toMatchObject({ key: "2026", start: new Date("2026-01-01T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") });
    expect(periodOf(d("2026-12-31"), "QUARTER").end).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
  it("the same period a year before", () => {
    const p = periodOf(d("2026-05-10"), "QUARTER");
    expect(previousYear(p)).toEqual({ start: new Date("2025-04-01T00:00:00Z"), end: new Date("2025-07-01T00:00:00Z") });
  });
  it("ended periods inside the deal's dates", () => {
    const keys = endedPeriods("MONTH", d("2026-08-15"), new Date("2026-10-20T00:00:00Z"), d("2026-11-19")).map((p) => p.key);
    expect(keys).toEqual(["2026-M08", "2026-M09", "2026-M10"]);
    expect(endedPeriods("QUARTER", d("2026-10-01"), null, d("2026-11-19"))).toEqual([]); // Q4 still running
    expect(endedPeriods("MONTH", d("2026-08-15"), new Date("2026-09-01T00:00:00Z"), d("2026-12-30")).map((p) => p.key)).toEqual(["2026-M08"]);
  });
});

describe("volume rebate", () => {
  const retro = cleanRules({ kind: "VOLUME", basis: "AMOUNT", retro: true, tiers: [{ from: 5000, pct: 3 }, { from: 1000, pct: 2 }] });
  it("tiers are sorted; nothing below the first target; progress and what's missing", () => {
    expect(retro.kind === "VOLUME" && retro.tiers.map((t) => t.from)).toEqual([1000, 5000]);
    expect(evaluate(retro, S({ amount: 400 }))).toMatchObject({ value: 0, pct: 0, next: { missing: 600, unit: "AMOUNT", pct: 2 }, progress: 40 });
  });
  it("retro: the reached % on the whole period", () => {
    expect(evaluate(retro, S({ amount: 3000 }))).toMatchObject({ value: 60, pct: 2, next: { missing: 2000, pct: 3 }, progress: 50 });
    expect(evaluate(retro, S({ amount: 6000 }))).toMatchObject({ value: 180, pct: 3, next: null, progress: 100 });
  });
  it("stepped: each % only on the part above its target", () => {
    const stepped = cleanRules({ kind: "VOLUME", basis: "AMOUNT", retro: false, tiers: [{ from: 1000, pct: 2 }, { from: 5000, pct: 3 }] });
    // 2 % of 1000..5000 (4000 → 80) + 3 % of 5000..6000 (1000 → 30)
    expect(evaluate(stepped, S({ amount: 6000 })).value).toBe(110);
  });
  it("units target: money still on the amount bought", () => {
    const u = cleanRules({ kind: "VOLUME", basis: "UNITS", tiers: [{ from: 100, pct: 4 }] });
    expect(evaluate(u, S({ amount: 2500, units: 120 })).value).toBe(100);
    expect(evaluate(u, S({ amount: 500, units: 30 })).next).toMatchObject({ missing: 70, unit: "UNITS" });
  });
});

describe("free goods", () => {
  it("buy X get Y, with a cap per period", () => {
    const r = cleanRules({ kind: "FREE_GOODS", buyUnits: 10, freeUnits: 1, maxFreePerPeriod: "" });
    expect(evaluate(r, S({ units: 34 }))).toMatchObject({ freeUnits: 3, value: 0, next: { missing: 6, unit: "UNITS", freeUnits: 1 }, progress: 40 });
    const capped = cleanRules({ kind: "FREE_GOODS", buyUnits: 10, freeUnits: 2, maxFreePerPeriod: 4 });
    expect(evaluate(capped, S({ units: 95 }))).toMatchObject({ freeUnits: 4, next: null, progress: 100 });
  });
  it("whole units only", () => {
    expect(() => cleanRules({ kind: "FREE_GOODS", buyUnits: 2.5, freeUnits: 1 })).toThrow(/whole/);
  });
});

describe("growth bonus", () => {
  const g = cleanRules({ kind: "GROWTH", base: "INCREASE", tiers: [{ growthPct: 10, pct: 5 }, { growthPct: 25, pct: 8 }], minPrevious: 500 });
  it("a % on the increase over last year", () => {
    expect(evaluate(g, S({ amount: 1150, previousAmount: 1000 }))).toMatchObject({ value: 7.5, pct: 5, next: { missing: 100, pct: 8 } }); // 5 % of 150
    expect(evaluate(g, S({ amount: 1050, previousAmount: 1000 }))).toMatchObject({ value: 0, next: { missing: 50, pct: 5 }, progress: 50 });
  });
  it("on everything bought; nothing without enough history", () => {
    const t = cleanRules({ kind: "GROWTH", base: "TOTAL", tiers: [{ growthPct: 10, pct: 2 }] });
    expect(evaluate(t, S({ amount: 2200, previousAmount: 2000 })).value).toBe(44);
    expect(evaluate(g, S({ amount: 900, previousAmount: 400 }))).toMatchObject({ value: 0, next: null });
  });
});

describe("product mix bonus", () => {
  const m = cleanRules({ kind: "MIX", minDistinct: 3, minUnitsEach: 2, rewardFixed: 50, rewardPct: "" });
  it("counts products with enough units each", () => {
    expect(evaluate(m, S({ amount: 800, perProductUnits: { a: 5, b: 1, c: 2 } }))).toMatchObject({ value: 0, next: { missing: 1, unit: "PRODUCTS" }, progress: 67 });
    expect(evaluate(m, S({ amount: 800, perProductUnits: { a: 5, b: 2, c: 2 } }))).toMatchObject({ value: 50, next: null, progress: 100 });
  });
  it("fixed + %", () => {
    const both = cleanRules({ kind: "MIX", minDistinct: 1, rewardFixed: 10, rewardPct: 2 });
    expect(evaluate(both, S({ amount: 1000, perProductUnits: { a: 1 } })).value).toBe(30);
    expect(() => cleanRules({ kind: "MIX", minDistinct: 2 })).toThrow(/fixed amount/);
  });
});

describe("rule checks and FIRINGI's limits", () => {
  it("refuses bad rules", () => {
    expect(() => cleanRules({ kind: "VOLUME", tiers: [] })).toThrow(/at least one step/);
    expect(() => cleanRules({ kind: "VOLUME", tiers: [{ from: 1, pct: 60 }] })).toThrow(/50/);
    expect(() => cleanRules({ kind: "VOLUME", tiers: [{ from: 1, pct: 2 }, { from: 1, pct: 3 }] })).toThrow(/own target/);
    expect(() => cleanRules({ kind: "VOLUME", tiers: [{ from: -1, pct: 2 }] })).toThrow(/numbers/);
    expect(() => cleanRules({ kind: "NOPE" })).toThrow(/kind/);
  });
  it("limits: highest % and fixed bonus", () => {
    const s = { ...DEFAULT_REBATE_SETTINGS, maxPct: 5, maxFixed: 100 };
    expect(limitProblem(cleanRules({ kind: "VOLUME", tiers: [{ from: 1, pct: 6 }] }), s)).toMatch(/5 %/);
    expect(limitProblem(cleanRules({ kind: "VOLUME", tiers: [{ from: 1, pct: 5 }] }), s)).toBeNull();
    expect(limitProblem(cleanRules({ kind: "MIX", minDistinct: 2, rewardFixed: 150 }), s)).toMatch(/fixed bonus/);
  });
  it("settings: merged with defaults, checked", () => {
    const m = mergeRebateSettings({ kinds: { GROWTH: false } as never, maxPct: 8 });
    expect(m.kinds).toEqual({ VOLUME: true, FREE_GOODS: true, GROWTH: false, MIX: true });
    expect(m.maxPct).toBe(8);
    expect(() => cleanRebateSettings({ ...DEFAULT_REBATE_SETTINGS, maxPct: 80 })).toThrow(/highest %/i);
    expect(cleanRebateSettings({ ...DEFAULT_REBATE_SETTINGS, approval: "weird" as never }).approval).toBe("ALWAYS");
  });
});

describe("spreading money over invoices", () => {
  it("in proportion, to the cent, adding up exactly", () => {
    const parts = spread(100, [1, 1, 1]);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    expect(spread(10, [0, 30, 10])).toEqual([0, 7.5, 2.5]);
    expect(spread(0, [5])).toEqual([0]);
    const x = spread(123.45, [17.2, 3.3, 99.1, 0, 41]);
    expect(Math.round(x.reduce((a, b) => a + b, 0) * 100) / 100).toBe(123.45);
  });
});
