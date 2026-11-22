/** Phase 62: sales rep rules (pure). */
import { describe, expect, it } from "vitest";
import { DEFAULT_SALES_REP_SETTINGS, commission, daysSince, mergeSalesRepSettings, monthRange } from "@/lib/sales-reps";

describe("sales rep rules", () => {
  it("settings", () => {
    expect(mergeSalesRepSettings(null)).toEqual(DEFAULT_SALES_REP_SETTINGS);
    expect(mergeSalesRepSettings({ confirmHours: 999, maxPhotos: -2 })).toMatchObject({ confirmHours: 168, maxPhotos: 0 });
  });
  it("months", () => {
    const r = monthRange("2026-11");
    expect(r.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(monthRange("2026-12").to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(monthRange(null, new Date(Date.UTC(2027, 1, 14))).key).toBe("2027-02");
  });
  it("commission and target", () => {
    expect(commission(12345.67, 3, 20000)).toEqual({ commission: 370.37, targetPct: 61.7 });
    expect(commission(500, 0, null)).toEqual({ commission: 0, targetPct: null });
  });
  it("days since", () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince(new Date(Date.now() - 3 * 86400_000 - 1000))).toBe(3);
  });
});
