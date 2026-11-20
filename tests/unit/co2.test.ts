import { describe, expect, it } from "vitest";
import { DEFAULT_CO2_SETTINGS as S, badges, cleanCo2Settings, deliveryFootprint, goalProgress, haversineKm, mergeCo2Settings, packFootprint, packKg, supplierGrade } from "@/lib/co2";

describe("CO₂ rules (Phase 51)", () => {
  it("measures straight-line distance (Lisbon → Porto ≈ 274 km)", () => {
    expect(haversineKm({ lat: 38.7223, lng: -9.1393 }, { lat: 41.1579, lng: -8.6291 })).toBeGreaterThan(270);
    expect(haversineKm({ lat: 38.7223, lng: -9.1393 }, { lat: 41.1579, lng: -8.6291 })).toBeLessThan(280);
    expect(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });

  it("uses net weight, else items × fallback weight", () => {
    expect(packKg({ netWeightKg: 6, unitsPerPack: 24 }, S)).toBe(6);
    expect(packKg({ netWeightKg: null, unitsPerPack: 24 }, S)).toBe(12);
    expect(packKg({ netWeightKg: 0, unitsPerPack: 0 }, S)).toBe(0.5);
  });

  it("adds product and packaging per pack, each part switchable", () => {
    const p = { kgPerKg: 0.4, netKg: 8, unitsPerPack: 24, packaging: "PLASTIC" as const };
    expect(packFootprint(p, S)).toEqual({ product: 3.2, packaging: 0.96, total: 4.16 });
    expect(packFootprint(p, { ...S, parts: { ...S.parts, packaging: false } }).total).toBe(3.2);
    expect(packFootprint(p, { ...S, parts: { ...S.parts, products: false } }).total).toBe(0.96);
    expect(packFootprint({ ...p, packaging: null }, S).packaging).toBe(0);
  });

  it("delivery = km × road factor × tonnes × fuel factor", () => {
    expect(deliveryFootprint(100, 500, "DIESEL", S)).toBe(39); // 100 × 1.3 × 0.5 × 0.6
    expect(deliveryFootprint(100, 500, "ELECTRIC", S)).toBe(7.8);
    expect(deliveryFootprint(0, 500, "DIESEL", S)).toBe(0);
  });

  it("gives badges against the category and FIRINGI's switches", () => {
    const base = { kgPerKg: 1, categoryKgPerKg: 2, packaging: "RETURNABLE" as const, recyclable: false, local: true };
    expect(badges(base, S)).toEqual(["LOW_CO2", "LOCAL", "ECO_PACKAGING"]);
    expect(badges({ ...base, kgPerKg: 1.5 }, S)).not.toContain("LOW_CO2"); // 75 % > 70 %
    expect(badges({ ...base, packaging: "PLASTIC", recyclable: true }, S)).toContain("ECO_PACKAGING");
    expect(badges({ ...base, packaging: "MIXED", recyclable: true }, S)).not.toContain("ECO_PACKAGING");
    expect(badges(base, { ...S, parts: { ...S.parts, local: false } })).not.toContain("LOCAL");
  });

  it("grades suppliers A–E", () => {
    expect(supplierGrade([]).grade).toBeNull();
    expect(supplierGrade([{ ratio: 0.5, eco: true, own: true }]).grade).toBe("A");
    expect(supplierGrade([{ ratio: 1, eco: false, own: false }])).toEqual({ grade: "E", score: 30 });
    expect(supplierGrade([{ ratio: 1, eco: true, own: false }]).grade).toBe("C");
    expect(supplierGrade([{ ratio: 2, eco: false, own: false }]).score).toBe(0);
  });

  it("tracks a yearly goal against last year", () => {
    expect(goalProgress(800, 1000, 10)).toEqual({ target: 900, change: -20, onTrack: true });
    expect(goalProgress(950, 1000, 10).onTrack).toBe(false);
    expect(goalProgress(100, 0, 10).onTrack).toBeNull();
  });

  it("merges saved settings with defaults and checks limits", () => {
    const m = mergeCo2Settings({ show: { badges: false } as never, lowPct: 50 });
    expect(m.show.badges).toBe(false);
    expect(m.show.reports).toBe(true);
    expect(m.lowPct).toBe(50);
    expect(m.fuels.DIESEL).toBe(0.6);
    expect(() => cleanCo2Settings({ ...S, lowPct: 5 })).toThrow(/Low CO₂/);
    expect(() => cleanCo2Settings({ ...S, roadFactor: 3 })).toThrow(/Road factor/);
    expect(cleanCo2Settings({ ...S, approval: "x" as never }).approval).toBe("ALWAYS");
  });
});
