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
