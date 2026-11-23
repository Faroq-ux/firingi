import { describe, expect, it } from "vitest";
import { KIND_AREA, REC_AREAS, change, fuelOf, kindsOf, mergeAiCentre, startOfWeek, tripCost, weekly, worthIt } from "@/lib/ai-centre";

describe("AI Centre rules", () => {
  it("settings: defaults, bounds, unknown fuel falls back", () => {
    const d = mergeAiCentre(null);
    expect(d.areas.ROUTES && d.forecasts.CASH && d.reports.FRAUD && d.weeklyEmail).toBe(true);
    const s = mergeAiCentre({ routeMinKm: 0, overdueDays: 999, defaultFuel: "STEAM" as never, fuels: { DIESEL: { per100: 8 } } as never, areas: { PRICING: false } as never });
    expect(s.routeMinKm).toBe(0.5);
    expect(s.overdueDays).toBe(180);
    expect(s.defaultFuel).toBe("DIESEL");
    expect(s.fuels.DIESEL).toEqual({ per100: 8, price: 1.65, co2: 2.68 });
    expect(s.areas).toMatchObject({ PRICING: false, SALES: true });
    expect(fuelOf("ELECTRIC", s)).toBe("ELECTRIC");
    expect(fuelOf(null, s)).toBe("DIESEL");
  });
  it("trip cost: litres or kWh, euros and CO₂ per km", () => {
    const s = mergeAiCentre(null);
    expect(tripCost(100, "DIESEL", s)).toEqual({ km: 100, fuel: "DIESEL", unit: "L", amount: 9, cost: 14.85, co2Kg: 24.12 });
    expect(tripCost(50, "ELECTRIC", s)).toMatchObject({ unit: "kWh", amount: 11, cost: 2.75, co2Kg: 2.2 });
    expect(tripCost(-5, "PETROL", s).amount).toBe(0);
  });
  it("a shorter route is worth it only past both thresholds", () => {
    const s = { routeMinKm: 3, routeMinPct: 8 };
    expect(worthIt(50, 45, s)).toBe(true);
    expect(worthIt(50, 48, s)).toBe(false); // 2 km
    expect(worthIt(100, 96, s)).toBe(false); // 4%
  });
  it("every kind belongs to one area; weekly buckets; change", () => {
    for (const a of REC_AREAS) expect(kindsOf(a).length).toBeGreaterThan(0);
    expect(KIND_AREA.ROUTE_SAVING).toBe("ROUTES");
    const now = new Date("2026-11-25T12:00:00Z"); // Wednesday
    expect(startOfWeek(now).toISOString()).toBe("2026-11-23T00:00:00.000Z");
    const w = weekly([{ at: new Date("2026-11-20T10:00:00Z"), v: 5 }, { at: new Date("2026-11-11T10:00:00Z"), v: 2 }, { at: new Date("2026-11-24T10:00:00Z"), v: 99 }], 3, now);
    expect(w).toEqual([0, 2, 5]); // this week's sale isn't counted yet
    expect(change([1, 1, 2, 2], 2)).toBe(1);
    expect(change([0, 0, 2, 2], 2)).toBeNull();
  });
});
