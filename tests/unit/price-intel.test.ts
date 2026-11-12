import { describe, expect, it } from "vitest";
import { deviationPct, jump, levelAt, marketStats, needsApproval, position, quantile, stepSeries } from "@/server/price-intel/stats";

const D = (s: string) => new Date(`${s}T12:00:00Z`);

describe("market statistics", () => {
  it("quantiles, median, spread", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const s = marketStats([10, 12, 11, 20, 0, NaN])!;
    expect(s).toMatchObject({ n: 4, min: 10, max: 20, median: 11.5, spreadPct: 100 });
    expect(marketStats([])).toBeNull();
  });
  it("position in the market", () => {
    const s = marketStats([10, 11, 12, 13, 20])!;
    expect(position(10, s)).toBe("CHEAPEST");
    expect(position(11.5, s)).toBe("BELOW_MEDIAN");
    expect(position(12.5, s)).toBe("ABOVE_MEDIAN");
    expect(position(20, s)).toBe("MOST_EXPENSIVE");
    expect(deviationPct(15, 12)).toBe(25);
  });
});

describe("history", () => {
  const log = [{ changedAt: D("2026-01-01"), newPrice: 10 }, { changedAt: D("2026-03-01"), newPrice: 11 }, { changedAt: D("2026-03-05"), newPrice: 12.5 }];
  it("price in force at a date", () => {
    expect(levelAt(log, D("2025-12-01"))).toBeNull();
    expect(levelAt(log, D("2026-02-01"))).toBe(10);
    expect(levelAt(log, D("2026-03-06"))).toBe(12.5);
    expect(levelAt([...log, { changedAt: D("2026-04-01"), newPrice: null }], D("2026-04-02"))).toBeNull();
  });
  it("jumps within a window (from the lowest level in it)", () => {
    expect(jump(log, D("2026-03-06"), 7, 15)).toEqual({ from: 10, to: 12.5, pct: 25 });
    expect(jump(log, D("2026-03-06"), 3, 15)).toBeNull(); // 11 → 12.5 = 13.6 %
    expect(jump(log, D("2026-05-01"), 7, 15)).toBeNull(); // window without changes
  });
  it("step series ends at now", () => {
    const s = stepSeries(log, D("2026-02-01"), D("2026-04-01"), 2);
    expect(s.map((p) => p.v)).toEqual([5, 5.5, 6.25, 6.25]);
  });
});

describe("approval of increases", () => {
  it("only increases above the threshold of an existing price", () => {
    expect(needsApproval(10, 11, 10)).toBe(false);
    expect(needsApproval(10, 11.01, 10)).toBe(true);
    expect(needsApproval(10, 9, 10)).toBe(false);
    expect(needsApproval(null, 50, 10)).toBe(false);
    expect(needsApproval(10, 20, 0)).toBe(false);
  });
});
