/** Add by barcode with AI: barcode check digit, switches per country / company, reading Open Food Facts records. */
import { describe, expect, it } from "vitest";
import { barcodeFamily } from "@/lib/barcode";
import { barcodeAiOn, innerGtin, mergeBa, offFacts, parseQuantity, unitFor, validGtin } from "@/lib/barcode-ai";

describe("barcodes", () => {
  it("accepts EAN-13 / EAN-8 / UPC / GTIN-14 with a correct check digit only", () => {
    expect(validGtin("5609876543212")).toBe("5609876543212");
    expect(validGtin("5609876543210")).toBeNull();
    expect(validGtin("96385074")).toBe("96385074");
    expect(validGtin("036000291452")).toBe("036000291452");
    expect(validGtin("10614141000415")).toBe("10614141000415");
    expect(validGtin("12345")).toBeNull();
    expect(validGtin("abc")).toBeNull();
    expect(validGtin("05609876543212")).toBe("5609876543212"); // GTIN-14 with a leading 0 = the same item
  });
  it("wholesale: a case code (GTIN-14) gives the single item's barcode", () => {
    expect(innerGtin("15609876543219")).toBe("5609876543212");
    expect(innerGtin("5609876543212")).toBeNull();
    expect(innerGtin("95609876543215")).toBeNull(); // 9 = variable measure, no fixed item
  });
  it("customer scans: a case code also finds the item inside; leading 0 forms are the same product", () => {
    expect(barcodeFamily("15609876543219").sort()).toEqual(["15609876543219", "5609876543212"].sort());
    expect(barcodeFamily("5609876543212")).toContain("05609876543212");
    expect(barcodeFamily("05609876543212")).toContain("5609876543212");
  });
});

describe("who may use it", () => {
  const s = mergeBa({ offCountries: ["es"], companies: { c1: "ON", c2: "OFF" } });
  it("suppliers only; countries left out; a company override wins", () => {
    expect(barcodeAiOn(s, { id: "x", type: "WHOLESALER", countryCode: "PT" })).toBe(true);
    expect(barcodeAiOn(s, { id: "x", type: "CUSTOMER", countryCode: "PT" })).toBe(false);
    expect(barcodeAiOn(s, { id: "x", type: "DISTRIBUTOR", countryCode: "ES" })).toBe(false);
    expect(barcodeAiOn(s, { id: "c1", type: "DISTRIBUTOR", countryCode: "ES" })).toBe(true);
    expect(barcodeAiOn(s, { id: "c2", type: "WHOLESALER", countryCode: "PT" })).toBe(false);
    expect(barcodeAiOn({ ...s, enabled: false }, { id: "c1", type: "WHOLESALER", countryCode: "PT" })).toBe(false);
    expect(barcodeAiOn({ ...s, sellers: { DISTRIBUTOR: false, WHOLESALER: true } }, { id: "x", type: "DISTRIBUTOR", countryCode: "PT" })).toBe(false);
  });
  it("settings are cleaned", () => {
    const m = mergeBa({ offCountries: ["pt", "bad1", "PT"], hourlyLimit: 99999, companies: { a: "ON", b: "MAYBE" as never } });
    expect(m.offCountries).toEqual(["PT"]);
    expect(m.hourlyLimit).toBe(1000);
    expect(m.companies).toEqual({ a: "ON" });
  });
});

describe("reading an Open Food Facts record", () => {
  it("names, brand, allergens, traces, diets, ingredients", () => {
    const f = offFacts({ product_name_pt: "Bolachas", product_name: "Biscuits", brands: "Casa Doce, Outra", allergens_tags: ["en:gluten", "en:milk"], traces_tags: ["en:nuts", "en:milk"], labels_tags: ["en:organic", "en:vegan"], ingredients_text_pt: "Farinha" });
    expect(f.names).toMatchObject({ pt: "Bolachas", xx: "Biscuits" });
    expect(f.brand).toBe("Casa Doce");
    expect(f.contain).toEqual(["GLUTEN", "MILK"]);
    expect(f.mayContain).toEqual(["NUTS"]);
    expect(f.diets).toEqual(["ORGANIC", "VEGAN"]);
    expect(f.ingredients).toEqual({ pt: "Farinha" });
  });
  it("pack sizes and units", () => {
    expect(parseQuantity("6 x 33 cl")).toEqual({ count: 6, size: "33 cl" });
    expect(parseQuantity("1,5 L")).toEqual({ count: 1, size: "1.5 l" });
    expect(unitFor("750 ml")).toBe("L");
    expect(unitFor("200 g")).toBe("KG");
    expect(unitFor("10")).toBe("UN");
  });
});
