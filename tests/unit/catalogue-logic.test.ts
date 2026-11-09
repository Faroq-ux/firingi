import { describe, expect, it } from "vitest";
import { resolvePrice, grossOf } from "@/server/catalogue/pricing";
import { browsableCategoryIds, categoryInfo, effectiveRestriction, withDescendants } from "@/server/catalogue/restrictions";
import { visibleOfferWhere } from "@/server/catalogue/visibility";
import Decimal from "decimal.js";

const c = (priceListId: string, scope: "BASE" | "CUSTOMER_GROUP" | "CUSTOMER" | "CONTRACT", minQty: number, price: number, priority = 0) =>
  ({ priceListId, scope, minQty, unitPriceNet: price, priority });

describe("resolvePrice", () => {
  it("most specific list wins: customer > group > base", () => {
    const cands = [c("base", "BASE", 1, 10), c("grp", "CUSTOMER_GROUP", 1, 9.5), c("cust", "CUSTOMER", 1, 9.8)];
    expect(resolvePrice(cands)!.priceListId).toBe("cust");
    expect(resolvePrice(cands.slice(0, 2))!.unitPriceNet.toNumber()).toBe(9.5);
  });
  it("uses the highest applicable tier and falls back when a specific list has no tier for the quantity", () => {
    const cands = [c("base", "BASE", 1, 10), c("base", "BASE", 10, 9), c("base", "BASE", 50, 8), c("cust", "CUSTOMER", 20, 7.5)];
    expect(resolvePrice(cands, 1)!.unitPriceNet.toNumber()).toBe(10);
    expect(resolvePrice(cands, 12)!.unitPriceNet.toNumber()).toBe(9);
    expect(resolvePrice(cands, 25)!).toMatchObject({ priceListId: "cust" });
    expect(resolvePrice(cands, 1)!.tiers.map((t) => t.minQty)).toEqual([1, 10, 50]);
  });
  it("priority then lower price break ties within the same scope", () => {
    expect(resolvePrice([c("a", "CUSTOMER_GROUP", 1, 9), c("b", "CUSTOMER_GROUP", 1, 9.9, 5)])!.priceListId).toBe("b");
    expect(resolvePrice([c("a", "CUSTOMER_GROUP", 1, 9), c("b", "CUSTOMER_GROUP", 1, 8.5)])!.priceListId).toBe("b");
  });
  it("returns null when there is no applicable price", () => {
    expect(resolvePrice([])).toBeNull();
    expect(resolvePrice([c("x", "BASE", 5, 1)], 1)).toBeNull();
  });
  it("computes gross with half-up rounding", () => {
    expect(grossOf(new Decimal("10.005"), 23).toFixed(2)).toBe("12.31");
  });
});

describe("restrictions through the category tree", () => {
  const cats = [
    { id: "bev", parentId: null, restriction: null, isActive: true },
    { id: "alc", parentId: "bev", restriction: "ALCOHOL" as const, isActive: true },
    { id: "wine", parentId: "alc", restriction: null, isActive: true },
    { id: "tob", parentId: null, restriction: "TOBACCO" as const, isActive: true },
    { id: "old", parentId: "bev", restriction: null, isActive: false },
    { id: "oldchild", parentId: "old", restriction: null, isActive: true },
  ];
  const info = categoryInfo(cats);
  it("children inherit restriction and inactivity", () => {
    expect(info.get("wine")!.restriction).toBe("ALCOHOL");
    expect(info.get("oldchild")!.active).toBe(false);
    expect(info.get("wine")!.ancestors).toEqual(["bev", "alc"]);
  });
  it("a product can add but not remove a restriction", () => {
    expect(effectiveRestriction({ categoryId: "bev", restriction: "ALCOHOL" }, info)).toBe("ALCOHOL");
    expect(effectiveRestriction({ categoryId: "wine", restriction: null }, info)).toBe("ALCOHOL");
  });
  it("browsable categories depend on approvals", () => {
    expect(browsableCategoryIds(info, []).sort()).toEqual(["bev"]);
    expect(browsableCategoryIds(info, ["ALCOHOL"]).sort()).toEqual(["alc", "bev", "wine"]);
    expect(withDescendants("bev", info).sort()).toEqual(["alc", "bev", "old", "oldchild", "wine"]);
  });
});

describe("visibility filter", () => {
  it("customers are restricted to wholesalers in their own country", () => {
    const w = visibleOfferWhere({ buyerCompanyId: "b", buyerType: "CUSTOMER", buyerCountryId: "PT", allowedRestrictions: [], browsableCategoryIds: ["x"] });
    expect(w).toMatchObject({ status: "ACTIVE", sellerType: "WHOLESALER", countryId: "PT", vendor: { status: "APPROVED", type: "WHOLESALER" } });
  });
  it("wholesalers see distributors from any EU country", () => {
    const w = visibleOfferWhere({ buyerCompanyId: "b", buyerType: "WHOLESALER", buyerCountryId: "PT", allowedRestrictions: [], browsableCategoryIds: ["x"] });
    expect(w.sellerType).toBe("DISTRIBUTOR");
    expect(w).not.toHaveProperty("countryId");
  });
});

describe("distance", () => {
  it("Lisbon–Porto is ~275 km; unknown distances sort last", async () => {
    const { haversineKm, byDistance } = await import("@/server/catalogue/distance");
    const km = haversineKm({ lat: 38.7223, lng: -9.1393 }, { lat: 41.1579, lng: -8.6291 });
    expect(km).toBeGreaterThan(270);
    expect(km).toBeLessThan(280);
    const list = [{ name: "b", distanceKm: null }, { name: "a", distanceKm: 5 }, { name: "c", distanceKm: 1 }].sort(byDistance);
    expect(list.map((x) => x.name)).toEqual(["c", "a", "b"]);
  });
});
