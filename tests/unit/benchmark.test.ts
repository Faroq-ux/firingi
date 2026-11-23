/** Phase 70: price benchmark rules — percentiles, position, band, yearly saving, groups, trend gap, switches. */
import { describe, expect, it } from "vitest";
import { GROUP_ORDER, band, groupLevel, percentile, position, riseGap, stats, yearlySaving } from "@/lib/benchmark";
import { buyerOn, mergeBench, supplierOn } from "@/server/benchmark/settings";

describe("statistics", () => {
  it("percentiles interpolate; one buyer counts once", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.9)).toBe(10);
    const s = stats([1, 2, 3, 4, 5, 0, NaN])!;
    expect(s.buyers).toBe(5);
    expect(s.p50).toBe(3);
    expect(s.p10).toBe(1.4);
    expect(stats([])).toBeNull();
  });
  it("position: share paying less", () => {
    const s = { p10: 1, p25: 1.5, p50: 2, p75: 2.5, p90: 3 };
    expect(position(2, s)).toBe(50);
    expect(position(2.25, s)).toBe(63);
    expect(position(0.5, s)).toBe(5);
    expect(position(3, s)).toBe(90);
    expect(position(6, s)).toBe(100);
  });
  it("band around the median (±3 %)", () => {
    expect(band(2.1, 2)).toBe("ABOVE");
    expect(band(2.05, 2)).toBe("AROUND");
    expect(band(1.9, 2)).toBe("BELOW");
  });
  it("yearly saving at the target", () => {
    expect(yearlySaving(2.5, 2, 90, 90)).toBe(182.5);
    expect(yearlySaving(1.5, 2, 90, 90)).toBe(0);
  });
  it("groups from specific to wide", () => {
    expect(GROUP_ORDER("r1", "cafe_bar").map(groupLevel)).toEqual(["REGION_TYPE", "REGION", "TYPE", "COUNTRY"]);
    expect(GROUP_ORDER(null, null).map(groupLevel)).toEqual(["COUNTRY"]);
    expect(GROUP_ORDER(null, "hotel").map(groupLevel)).toEqual(["TYPE", "COUNTRY"]);
  });
  it("trend gap in points", () => {
    expect(riseGap(2, 2.3, 2, 2.06)).toBe(12);
    expect(riseGap(2, 2, 2, 2.2)).toBe(-10);
    expect(riseGap(0, 2, 2, 2)).toBe(0);
  });
});

describe("switches", () => {
  const s = mergeBench({ offCountries: ["lu"], offTypes: ["hotel"] });
  it("audiences, countries, kinds of business, override", () => {
    expect(buyerOn(s, { id: "a", type: "CUSTOMER", countryCode: "PT" })).toBe(true);
    expect(buyerOn(s, { id: "a", type: "CUSTOMER", countryCode: "LU" })).toBe(false);
    expect(buyerOn(s, { id: "a", type: "CUSTOMER", countryCode: "PT", businessType: "hotel" })).toBe(false);
    expect(buyerOn({ ...s, companies: { a: "ON" } }, { id: "a", type: "CUSTOMER", countryCode: "LU" })).toBe(true);
    expect(buyerOn({ ...s, companies: { a: "OFF" } }, { id: "a", type: "CUSTOMER", countryCode: "PT" })).toBe(false);
    expect(buyerOn(s, { id: "a", type: "DISTRIBUTOR", countryCode: "PT" })).toBe(false);
    expect(supplierOn(s, { id: "v", type: "DISTRIBUTOR" })).toBe(true);
    expect(supplierOn({ ...s, supplierView: false }, { id: "v", type: "DISTRIBUTOR" })).toBe(false);
  });
  it("minimum buyers kept in range (anonymity)", () => {
    expect(mergeBench({ minBuyers: 1 }).minBuyers).toBe(3);
    expect(mergeBench({ periodDays: 5 }).periodDays).toBe(30);
  });
});
