import { describe, expect, it } from "vitest";
import { mergeAssortmentSettings, mustStockGaps, parseSkus, resolveRules, visibleUnder } from "@/lib/assortments";

describe("assortment rules", () => {
  it("approved list per supplier, hidden items, the customer's own list wins, must-stock stays visible", () => {
    const r = resolveRules([
      { vendorId: "v1", mode: "ONLY_LISTED", target: "ALL", items: [{ offerId: "a", mustStock: false }, { offerId: "b", mustStock: true }] },
      { vendorId: "v1", mode: "HIDE_LISTED", target: "GROUP", items: [{ offerId: "b", mustStock: false }, { offerId: "c", mustStock: false }] },
      { vendorId: "v1", mode: "MUST_STOCK", target: "CUSTOMER", items: [{ offerId: "d", mustStock: true }] },
      { vendorId: "v2", mode: "HIDE_LISTED", target: "ALL", items: [{ offerId: "x", mustStock: false }] },
    ]);
    expect(visibleUnder(r, { id: "a", vendorId: "v1" })).toBe(true);
    expect(visibleUnder(r, { id: "b", vendorId: "v1" })).toBe(false); // hidden by a group list
    expect(visibleUnder(r, { id: "c", vendorId: "v1" })).toBe(false);
    expect(visibleUnder(r, { id: "d", vendorId: "v1" })).toBe(true); // must-stock for this customer, off the approved list
    expect(visibleUnder(r, { id: "e", vendorId: "v1" })).toBe(false); // not on the approved list
    expect(visibleUnder(r, { id: "x", vendorId: "v2" })).toBe(false);
    expect(visibleUnder(r, { id: "y", vendorId: "v2" })).toBe(true); // no approved list for v2
    expect([...r.mustStock.keys()].sort()).toEqual(["d"]); // b is hidden → not must-stock
    const own = resolveRules([
      { vendorId: "v1", mode: "HIDE_LISTED", target: "ALL", items: [{ offerId: "b", mustStock: false }] },
      { vendorId: "v1", mode: "ONLY_LISTED", target: "CUSTOMER", items: [{ offerId: "b", mustStock: false }] },
    ]);
    expect(visibleUnder(own, { id: "b", vendorId: "v1" })).toBe(true);
  });
  it("gaps: never ordered first, then oldest", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const g = mustStockGaps([{ offerId: "a" }, { offerId: "b" }, { offerId: "c" }], new Map([["a", new Date("2026-11-10T00:00:00Z")], ["b", new Date("2026-09-01T00:00:00Z")]]), 30, now);
    expect(g.map((x) => [x.offerId, x.gap, x.days])).toEqual([["c", true, null], ["b", true, 80], ["a", false, 10]]);
  });
  it("SKUs pasted in any form; settings clamped", () => {
    expect(parseSkus("abc-1, ABC-1;\nxyz 2")).toEqual(["ABC-1", "XYZ", "2"]);
    const s = mergeAssortmentSettings({ gapDays: 2, modes: { HIDE_LISTED: false } as never });
    expect(s.gapDays).toBe(7);
    expect(s.modes).toEqual({ ONLY_LISTED: true, HIDE_LISTED: false, MUST_STOCK: true });
  });
});
