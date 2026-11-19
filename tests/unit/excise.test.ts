/** Phase 43: excise rules — duty per sold unit for each basis, sugar bands, missing measures, settings, licences. */
import { describe, expect, it } from "vitest";
import { bandFor, daysLeft, dutyPerUnit, licenceRule, licenceValid, measure, mergeExciseSettings, missingFor, monthRange, parseBands, rateOn } from "@/lib/excise";

describe("duty per unit", () => {
  it("alcohol: per hl per % vol (beer), per hl of pure alcohol (spirits), per hl (wine)", () => {
    // a case of 24 × 33 cl at 5,2 % vol, 4,50 € / hl / % vol → 4,5 × 0,0792 hl × 5,2
    expect(dutyPerUnit("HL_PER_ABV", { rate: 4.5 }, { volumeL: 7.92, abv: 5.2 })!.toFixed(4)).toBe("1.8533");
    // a 70 cl bottle at 40 % → 0,28 l of pure alcohol × 1476,15 € / hl
    expect(dutyPerUnit("HL_PURE_ALCOHOL", { rate: 1476.15 }, { volumeL: 0.7, abv: 40 })!.toFixed(4)).toBe("4.1332");
    expect(dutyPerUnit("HL_PRODUCT", { rate: 0 }, { volumeL: 4.5, abv: 13 })!.toFixed(2)).toBe("0.00");
    expect(measure({ volumeL: 0.7, abv: 40 })).toMatchObject({ litres: 0.7, lpa: 0.28, ml: 700 });
  });
  it("tobacco: per 1000 units plus a % of the price; per kg", () => {
    // a carton of 200 cigarettes at 47 € net: 117,27 × 0,2 + 14 % × 47
    expect(dutyPerUnit("THOUSAND_UNITS", { rate: 117.27, adValoremPct: 14 }, { exciseUnits: 200 }, 47)!.toFixed(4)).toBe("30.0340");
    expect(dutyPerUnit("KG", { rate: 80 }, { netKg: 0.05 })!.toFixed(2)).toBe("4.00");
    // ad valorem is only for tobacco
    expect(dutyPerUnit("ML", { rate: 0.33, adValoremPct: 50 }, { volumeL: 0.01 }, 100)!.toFixed(2)).toBe("3.30");
  });
  it("sugar: the band the drink falls in, per hl", () => {
    const bands = parseBands([{ maxGPerL: null, perHl: 22.76 }, { maxGPerL: 25, perHl: 1.13 }, { maxGPerL: 50, perHl: 6.89 }, { maxGPerL: 80, perHl: 9.1 }]);
    expect(bands.map((b) => b.maxGPerL)).toEqual([25, 50, 80, null]);
    expect(bandFor(bands, 24.9)?.perHl).toBe(1.13);
    expect(bandFor(bands, 25)?.perHl).toBe(6.89);
    expect(bandFor(bands, 106)?.perHl).toBe(22.76);
    // a case of 24 cans of cola (7,92 l, 106 g/l) → 22,76 € × 0,0792 hl
    expect(dutyPerUnit("HL_SUGAR_BAND", { rate: 0, bands }, { volumeL: 7.92, sugarGPerL: 106 })!.toFixed(4)).toBe("1.8026");
  });
  it("a missing measure gives no duty, and says what is missing", () => {
    expect(dutyPerUnit("HL_PER_ABV", { rate: 4.5 }, { volumeL: 7.92 })).toBeNull();
    expect(missingFor("HL_PER_ABV", { volumeL: 7.92 })).toEqual(["abv"]);
    expect(missingFor("THOUSAND_UNITS", {})).toEqual(["exciseUnits"]);
    expect(missingFor("HL_SUGAR_BAND", { volumeL: 1, sugarGPerL: 0 })).toEqual([]);
  });
});

describe("rates, licences, settings", () => {
  it("the rate valid on a day", () => {
    const r = [{ id: "a", validFrom: new Date("2025-01-01"), validTo: new Date("2025-12-31") }, { id: "b", validFrom: new Date("2026-01-01"), validTo: null }];
    expect(rateOn(r, new Date("2025-06-01"))?.id).toBe("a");
    expect(rateOn(r, new Date("2026-03-01"))?.id).toBe("b");
    expect(rateOn(r, new Date("2024-03-01"))).toBeNull();
  });
  it("a licence counts when approved, current and not superseded", () => {
    const at = new Date("2026-11-18T10:00:00Z");
    expect(licenceValid({ status: "APPROVED", expiresOn: new Date("2026-11-18") }, at)).toBe(true);
    expect(licenceValid({ status: "APPROVED", expiresOn: new Date("2026-11-17") }, at)).toBe(false);
    expect(licenceValid({ status: "PENDING", expiresOn: null }, at)).toBe(false);
    expect(licenceValid({ status: "APPROVED", expiresOn: null, supersededAt: new Date() }, at)).toBe(false);
    expect(daysLeft(new Date("2026-12-18"), at)).toBe(30);
  });
  it("settings: defaults, country overrides, cleaning", () => {
    const d = mergeExciseSettings(null);
    expect(d).toMatchObject({ enabled: true, licences: { buyer: true, enforcement: "BLOCK", supplier: false }, restrictions: { driverCheck: false }, duty: { calculate: true } });
    const s = mergeExciseSettings({ licences: { enforcement: "WARN", countries: { ES: { buyer: false }, pt: { buyer: false }, FR: { enforcement: "BLOCK" } }, reminderDays: [7, 30, 30, 500] } });
    expect(s.licences.countries).toEqual({ ES: { buyer: false }, FR: { enforcement: "BLOCK" } });
    expect(s.licences.reminderDays).toEqual([30, 7]);
    expect(licenceRule(s, "ES")).toEqual({ needed: false, enforcement: "WARN" });
    expect(licenceRule(s, "FR")).toEqual({ needed: true, enforcement: "BLOCK" });
    expect(licenceRule({ ...s, enabled: false }, "PT").needed).toBe(false);
    expect(monthRange("2026-13")).toBeNull();
  });
});
