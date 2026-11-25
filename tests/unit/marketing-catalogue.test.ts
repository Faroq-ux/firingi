/** Marketing catalogues: options, filters, items and pages. */
import { describe, expect, it } from "vitest";
import { cleanItems, mergeFilters, mergeOptions, packPages } from "@/lib/marketing-catalogue";

describe("marketing catalogue rules", () => {
  it("options and filters are cleaned", () => {
    expect(mergeOptions({ price: "GROSS", barcode: false, supplier: "AREA" })).toEqual({ price: "GROSS", barcode: false, qty: true, supplier: "AREA", qr: true });
    expect(mergeOptions({ price: "X" as never })).toMatchObject({ price: "NET" });
    expect(mergeFilters({ max: 999 })).toMatchObject({ max: 200, bestSellers: true, withImages: false });
    expect(mergeFilters({ max: 0, q: "  água " })).toMatchObject({ max: 1, q: "água" });
  });
  it("items: no duplicates, max 200, sections kept", () => {
    expect(cleanItems(["a", { offerId: "b", section: " Drinks " }, "a", 5, { offerId: "" }])).toEqual([{ offerId: "a", section: null }, { offerId: "b", section: "Drinks" }]);
    expect(cleanItems(Array.from({ length: 300 }, (_, i) => `o${i}`)).length).toBe(200);
  });
  it("pages: sections flow on the same page; a header stays with its first row; full pages break", () => {
    const items = ["A", null, null, "B", null, "C", null, null, null].map((sec, i) => ({ id: i, section: sec }));
    const pages = packPages(items, 2, 200, 30, 740);
    const shape = pages.map((p) => p.map((b) => (b.kind === "header" ? `#${b.title}` : String(b.items.length))).join(" "));
    expect(shape).toEqual(["#A 2 1 #B 2", "#C 2 2"]);
  });
});

import { barRuns, eanModules, printableBarcode } from "@/lib/marketing-catalogue";

/** Decode modules back to digits (test only): proves the bars encode the number. */
function decode13(m: string) {
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join("")), G = R.map((p) => [...p].reverse().join(""));
  const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const left = Array.from({ length: 6 }, (_, i) => m.slice(3 + i * 7, 10 + i * 7));
  const right = Array.from({ length: 6 }, (_, i) => m.slice(50 + i * 7, 57 + i * 7));
  const par = left.map((c) => (L.includes(c) ? "L" : "G")).join("");
  return String(PARITY.indexOf(par)) + left.map((c) => (L.includes(c) ? L.indexOf(c) : G.indexOf(c))).join("") + right.map((c) => R.indexOf(c)).join("");
}

describe("scannable barcodes", () => {
  it("EAN-13: guards, 95 modules, decodes back to the number", () => {
    for (const code of ["5449000000996", "4006381333931", "5601111222333"]) {
      const e = eanModules(code)!;
      expect(e.modules).toHaveLength(95);
      expect(e.modules.slice(0, 3)).toBe("101");
      expect(e.modules.slice(45, 50)).toBe("01010");
      expect(decode13(e.modules)).toBe(code);
    }
  });
  it("UPC-A, GTIN-14 with 0, EAN-8; wrong check digit or case code → none", () => {
    expect(eanModules("036000291452")?.digits).toBe("0036000291452");
    expect(eanModules("05449000000996")?.digits).toBe("5449000000996");
    expect(eanModules("96385074")?.modules).toHaveLength(67);
    expect(eanModules("5449000000995")).toBeNull();
    expect(eanModules("15609876543219")).toBeNull();
    expect(printableBarcode("15609876543219", "5609876543212")?.digits).toBe("5609876543212");
  });
  it("bars are runs of black modules", () => {
    expect(barRuns("1011100")).toEqual([[0, 1], [2, 3]]);
  });
});
