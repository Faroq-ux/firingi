import { describe, expect, it } from "vitest";
import { daysOfCover, holtForecast, median, nextOrder, trendOf } from "@/server/ai/forecast";

describe("forecasting maths", () => {
  it("follows a steady trend and never goes below zero", () => {
    const f = holtForecast([10, 12, 14, 16, 18, 20], 3);
    expect(f[0]).toBeGreaterThan(20);
    expect(f[2]).toBeGreaterThan(f[0]);
    expect(holtForecast([30, 20, 10, 5, 1], 4).every((v) => v >= 0)).toBe(true);
    expect(holtForecast([4, 6], 2)).toEqual([5, 5]);
    expect(holtForecast([], 2)).toEqual([0, 0]);
  });
  it("trend compares the next weeks with the last weeks", () => {
    expect(trendOf([10, 10, 10, 10], [15, 15])).toBe(0.5);
    expect(trendOf([0, 0], [3, 3])).toBeNull();
  });
  it("days of cover and status", () => {
    expect(daysOfCover(0, 5)).toEqual({ days: 0, status: "OUT" });
    expect(daysOfCover(30, 5)).toEqual({ days: 6, status: "CRITICAL" });
    expect(daysOfCover(60, 5)).toEqual({ days: 12, status: "LOW" });
    expect(daysOfCover(200, 5)).toEqual({ days: 40, status: "OK" });
    expect(daysOfCover(10, 0)).toEqual({ days: null, status: "NO_SALES" });
  });
  it("next expected order from the usual gap", () => {
    const d = (n: number) => new Date(Date.UTC(2026, 9, n));
    const r = nextOrder([d(1), d(8), d(15), d(22)], d(31))!;
    expect(r.gapDays).toBe(7);
    expect(r.expected.toISOString().slice(0, 10)).toBe("2026-10-29");
    expect(r.overdueDays).toBe(2);
    expect(r.due).toBe(true);
    expect(nextOrder([d(1)])).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});
