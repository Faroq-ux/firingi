/** Shelf price labels: margin prices, unit price, sizes from names, promo, reprint, switches. */
import { describe, expect, it } from "vitest";
import { allowedFields, cleanCustom, customFormat, sizeClass, contentFromName, marginOf, mergeSl, needsPrint, priceFromMargin, shownPrice, slOn, unitPrice, DEFAULT_FIELDS, FORMATS } from "@/lib/shelf-labels";

describe("shelf label rules", () => {
  it("price from margin: case split per item, VAT, ending in 9", () => {
    // case of 24 at 13.30 → 0.5542 per can, +40% = 0.7758, +23% VAT = 0.9543 → 0.99
    expect(priceFromMargin(13.3 / 24, 40, 23).toFixed(2)).toBe("0.99");
    expect(priceFromMargin(1, 30, 23, "CENT").toFixed(2)).toBe("1.60");
    expect(priceFromMargin(1, 30, 23).toFixed(2)).toBe("1.69");
    expect(marginOf("1.69", "1", "23")?.toString()).toBe("37.4");
  });
  it("content from the product name and unit price", () => {
    expect(contentFromName("Coca-Cola lata 33cl")).toEqual({ content: 0.33, unit: "L" });
    expect(contentFromName("Água Luso 1,5L")).toEqual({ content: 1.5, unit: "L" });
    expect(contentFromName("Mozzarella bloco 2kg")).toEqual({ content: 2, unit: "KG" });
    expect(contentFromName("Biscoitos 500 g")).toEqual({ content: 0.5, unit: "KG" });
    expect(contentFromName("Caixa de pizza 33cm")).toBeNull();
    expect(unitPrice("0.99", "0.33", "L")?.toFixed(2)).toBe("3.00");
    expect(unitPrice("0.99", null, "L")).toBeNull();
  });
  it("promo shown while it runs; reprint when price or promo changed", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(shownPrice({ priceGross: "1.99", promoPrice: "1.49", promoUntil: new Date("2026-11-30") }, now)).toMatchObject({ promo: true });
    expect(shownPrice({ priceGross: "1.99", promoPrice: "1.49", promoUntil: new Date("2026-11-01") }, now).promo).toBe(false);
    expect(needsPrint({ priceGross: "1.99" }, now)).toBe(true);
    expect(needsPrint({ priceGross: "1.99", printedPrice: "1.99", printedAt: now }, now)).toBe(false);
    expect(needsPrint({ priceGross: "2.09", printedPrice: "1.99", printedAt: now }, now)).toBe(true);
    expect(needsPrint({ priceGross: "1.99", promoPrice: "1.49", printedPrice: "1.99", printedAt: now }, now)).toBe(true);
  });
  it("switches: buyer types, countries, companies; brand / origin / QR as FIRINGI allows", () => {
    const s = mergeSl({ offCountries: ["pt"], companies: { c2: "ON" }, allowOrigin: false, allowQr: false });
    expect(slOn(s, { id: "c1", type: "CUSTOMER", countryCode: "PT" })).toBe(false);
    expect(slOn(s, { id: "c2", type: "CUSTOMER", countryCode: "PT" })).toBe(true);
    expect(slOn(s, { id: "c3", type: "DISTRIBUTOR", countryCode: "ES" })).toBe(false);
    expect(allowedFields({ ...DEFAULT_FIELDS, origin: true, code: "QR" }, s)).toMatchObject({ origin: false, code: "BARCODE" });
  });
  it("formats fit on the page", () => {
    for (const f of Object.values(FORMATS)) { expect(f.cols * f.w).toBeLessThanOrEqual(f.pageW + 0.01); expect(f.rows * f.h).toBeLessThanOrEqual(f.pageH + 0.01); }
  });
  it("own size: as many as fit on A4, margins and gaps for sticker sheets, rolls, limits", () => {
    const MM = 2.834645669;
    // 70 × 37 centred: 3 × 8 = 24
    const a = customFormat({ paper: "A4", w: 70, h: 37 })!;
    expect([a.cols, a.rows]).toEqual([3, 8]);
    expect(a.mx).toBeCloseTo(0, 1);
    // Apli-style 63.5 × 38.1, top 15.1, left 7.2, gap 2.5 across → 3 × 7
    const b = customFormat({ paper: "A4", w: 63.5, h: 38.1, top: 15.1, left: 7.2, gapX: 2.5 })!;
    expect([b.cols, b.rows]).toEqual([3, 7]);
    expect(b.mx / MM).toBeCloseTo(7.2, 1);
    expect(b.my / MM).toBeCloseTo(15.1, 1);
    // every label inside the page
    for (const f of [a, b]) {
      expect(f.mx + f.cols * f.w + (f.cols - 1) * (f.gx ?? 0)).toBeLessThanOrEqual(f.pageW + 0.01);
      expect(f.my + f.rows * f.h + (f.rows - 1) * (f.gy ?? 0)).toBeLessThanOrEqual(f.pageH + 0.01);
    }
    // a roll: one label per page of exactly that size
    const r = customFormat({ paper: "ROLL", w: 50, h: 30 })!;
    expect([r.cols, r.rows, Math.round(r.pageW / MM), Math.round(r.pageH / MM)]).toEqual([1, 1, 50, 30]);
    // limits and too big
    expect(cleanCustom({ w: 5, h: 999, top: -3 })).toMatchObject({ w: 25, h: 287, top: 0 });
    expect(customFormat({ paper: "A4", w: 200, h: 200, top: 60 })).toBeNull();
    expect([sizeClass(105, 148), sizeClass(105, 50), sizeClass(70, 37)]).toEqual(["L", "M", "S"]);
    expect(mergeSl({}).allowCustomSize).toBe(true);
    expect(mergeSl({ allowCustomSize: false }).allowCustomSize).toBe(false);
  });
});
