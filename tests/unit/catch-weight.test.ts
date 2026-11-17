import { describe, expect, it } from "vitest";
import {
  billedKg, cleanPieces, DEFAULT_CATCH_WEIGHT_SETTINGS, estimatedKg, gtin14, mergeCatchWeightSettings, parseGs1, parseKg, parseWeightLabel, prepayBuffer, pricePerKg, sumKg, tolerancePct, unitEquivalent,
} from "@/lib/catch-weight";

const ean = (twelve: string) => twelve + ((10 - (twelve.split("").map(Number).reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10);

describe("catch-weight rules", () => {
  it("merges settings and picks the tighter limit", () => {
    const s = mergeCatchWeightSettings({ maxOverPct: { default: 10, PT: 8 } });
    expect(s.ean13.prefixes).toEqual(["28", "29"]);
    expect(tolerancePct(s, "PT", null)).toBe(8);
    expect(tolerancePct(s, "ES", null)).toBe(10);
    expect(tolerancePct(s, "PT", 5)).toBe(5);
    expect(tolerancePct(s, "PT", 20)).toBe(8); // a supplier can't loosen FIRINGI's limit
    expect(mergeCatchWeightSettings(null)).toEqual(DEFAULT_CATCH_WEIGHT_SETTINGS);
  });

  it("bills the real weight, capped above the limit unless accepted", () => {
    expect(estimatedKg(3, "3.5").toNumber()).toBe(10.5);
    const base = { units: 2, nominalKg: 2, tolerancePct: 5 };
    expect(billedKg(base)).toMatchObject({ weighed: false, over: false });
    expect(billedKg(base).billed.toNumber()).toBe(4);
    expect(billedKg({ ...base, actualKg: 3.9 }).billed.toNumber()).toBe(3.9); // lighter: pays less
    const over = billedKg({ ...base, actualKg: 4.7 });
    expect(over).toMatchObject({ over: true, capped: true });
    expect(over.billed.toNumber()).toBe(4.2);
    expect(billedKg({ ...base, actualKg: 4.7, accepted: true }).billed.toNumber()).toBe(4.7);
    expect(billedKg({ ...base, actualKg: 4.2 })).toMatchObject({ over: false, capped: false });
    expect(unitEquivalent(10.1, 2).toNumber()).toBe(5.05);
    expect(pricePerKg(13.5, 2).toNumber()).toBe(6.75);
    expect(prepayBuffer(83.03, 10).toNumber()).toBe(8.31); // rounded up
  });

  it("reads weights typed by hand", () => {
    expect(cleanPieces(["2,05", 1.98, "2"])).toEqual([2.05, 1.98, 2]);
    expect(cleanPieces([1, 0])).toBeNull();
    expect(cleanPieces([])).toBeNull();
    expect(cleanPieces("2")).toBeNull();
    expect(sumKg([2.05, 1.98, 2.1]).toNumber()).toBe(6.13);
    expect(parseKg("1,5")).toBe(1.5);
    expect(parseKg("1500 g")).toBe(1.5);
    expect(parseKg("2.25kg")).toBe(2.25);
    expect(parseKg("abc")).toBeNull();
  });

  it("reads scale labels: EAN-13 2x and GS1 with AI 310n", () => {
    expect(parseWeightLabel(ean("284123402150"))).toMatchObject({ kind: "EAN13", item: "41234", kg: 2.15 });
    expect(parseWeightLabel(ean("204123402150"))).toBeNull(); // not a weight prefix
    expect(parseWeightLabel("2841234021509")).toBeNull(); // wrong check digit (unless it happens to be right)
    expect(parseWeightLabel(ean("5602000000209").slice(0, 13))).toBeNull(); // ordinary product barcode
    expect(parseWeightLabel(ean("2841234" + "02150"), { prefixes: ["28"], itemDigits: 5, valueDigits: 5, gramsPerUnit: 10 })?.kg).toBe(21.5);
    expect(parseWeightLabel("(01)05601234567890(3103)003620(10)LOT7")).toMatchObject({ kind: "GS1", gtin: "05601234567890", kg: 3.62, lot: "LOT7" });
    expect(parseWeightLabel("]C10105601234567890" + "3102000125" + "10LOT7")).toMatchObject({ kind: "GS1", kg: 1.25, lot: "LOT7" });
    expect(parseWeightLabel("01056012345678901005\x1d3103001500")).toMatchObject({ kg: 1.5, lot: "05" });
    expect(parseWeightLabel("(01)05601234567890(10)LOT")).toBeNull(); // no weight
    expect(parseGs1("(01)123")).toEqual({ "01": "123" });
    expect(parseGs1("hello")).toBeNull();
    expect(gtin14("5601234567890")).toBe("05601234567890");
    expect(gtin14("abc")).toBeNull();
  });
});
