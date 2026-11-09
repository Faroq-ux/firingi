import { describe, expect, it } from "vitest";
import { asBarcode, isValidGtin, makeEan13 } from "@/lib/barcode";
import { taxLabel } from "@/lib/tax-label";

describe("barcodes", () => {
  it("validates EAN-13 / GTIN check digits", () => {
    expect(isValidGtin("5449000000996")).toBe(true); // Coca-Cola 33cl can
    expect(isValidGtin("5449000000997")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true); // EAN-8
    expect(isValidGtin("12345")).toBe(false);
    expect(makeEan13("560123456789")).toHaveLength(13);
    expect(isValidGtin(makeEan13("560123456789"))).toBe(true);
  });
  it("recognises scanned / typed barcodes", () => {
    expect(asBarcode(" 5449000 000996 ")).toBe("5449000000996");
    expect(asBarcode("coca cola")).toBeNull();
  });
});

describe("tax label", () => {
  it("is country-specific", () => {
    expect(taxLabel("PT")).toBe("IVA");
    expect(taxLabel("ES", "IGIC")).toBe("IGIC");
    expect(taxLabel("DE")).toBe("MwSt.");
    expect(taxLabel("XX")).toBe("VAT");
  });
});
