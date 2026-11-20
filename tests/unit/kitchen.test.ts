import { describe, expect, it } from "vitest";
import {
  DEFAULT_KITCHEN_SETTINGS as D, cleanKitchenSettings, costRecipe, daysUntil, engineer, foodCostPct, makesCycle, marginOf, mergeKitchenSettings, orderLess, packContent,
  perUnit, purchaseCost, roundPrice, suggestPrice, toBase, wasteSummary, weeklyWaste, whatIf, type IngredientLite, type RecipeLite,
} from "@/lib/kitchen";

const ing = (id: string, unit: "KG" | "L" | "PCS", cost: number | null, yieldPct = 100, allergens: string[] = [], co2: number | null = null): IngredientLite => ({ id, name: id, unit, cost, yieldPct, allergens, co2PerUnit: co2 });

describe("menu costing rules (Phase 54)", () => {
  it("reads what a pack holds from its name", () => {
    expect(packContent({ name: "Case 6 × 2kg", unitsPerPack: 6 })).toEqual({ size: 12, unit: "KG" });
    expect(packContent({ name: "Caixa 6 × 1L", unitsPerPack: 6 })).toEqual({ size: 6, unit: "L" });
    expect(packContent({ name: "Case 24 × 33cl", unitsPerPack: 24 })).toEqual({ size: 7.92, unit: "L" });
    expect(packContent({ name: "Garrafa 750ml", unitsPerPack: 1 })).toEqual({ size: 0.75, unit: "L" });
    expect(packContent({ name: "Saco 500 g", unitsPerPack: 1 })).toEqual({ size: 0.5, unit: "KG" });
    expect(packContent({ name: "Pack 6 × 1,5L", unitsPerPack: 6 })).toEqual({ size: 9, unit: "L" });
    expect(packContent({ name: "Bundle of 100", unitsPerPack: 100 })).toEqual({ size: 100, unit: "PCS" });
    expect(packContent({ name: "Box", unitsPerPack: 1, netWeightKg: 10 })).toEqual({ size: 10, unit: "KG" });
  });

  it("converts units; kg ↔ l counts as 1:1 and says so; pieces never convert", () => {
    expect(toBase(250, "G", "KG")).toEqual({ qty: 0.25, approx: false, ok: true });
    expect(toBase(200, "ML", "KG")).toEqual({ qty: 0.2, approx: true, ok: true });
    expect(toBase(2, "PCS", "KG").ok).toBe(false);
    expect(toBase(1, "PACK", "KG").ok).toBe(false);
  });

  it("cost from purchases: the last price or the quantity-weighted average", () => {
    const at = (d: string) => new Date(`2026-${d}T10:00:00Z`);
    const lines = [{ unitPriceNet: 20, qty: 1, at: at("11-01") }, { unitPriceNet: 30, qty: 3, at: at("11-15") }, { unitPriceNet: 10, qty: 5, at: at("01-01") }];
    expect(purchaseCost(lines, "LAST")).toEqual({ packPrice: 30, basis: "LAST" });
    expect(purchaseCost(lines, "AVERAGE", at("10-01"))).toEqual({ packPrice: 27.5, basis: "AVERAGE" });
    expect(purchaseCost([], "LAST")).toBeNull();
    expect(perUnit(23.4, 12)).toBe(1.95);
  });

  it("costs a dish with yield, a sub-recipe made by the batch, allergens and CO₂", () => {
    const ings = new Map([
      ["onion", ing("onion", "KG", 1.2, 80, [], 0.5)], ["oil", ing("oil", "L", 6, 100, [], 3)], ["pita", ing("pita", "PCS", 0.25, 100, ["GLUTEN"], 0.1)],
      ["yog", ing("yog", "KG", 3, 100, ["MILK"], 2)], ["meat", ing("meat", "KG", 9, 75, [], 20)],
    ]);
    const recs = new Map<string, RecipeLite>([
      ["sauce", { id: "sauce", name: "Garlic sauce", kind: "SUB", yieldQty: 2, yieldUnit: "KG", lines: [{ ingredientId: "yog", subRecipeId: null, qty: 1.8, unit: "KG" }, { ingredientId: "oil", subRecipeId: null, qty: 200, unit: "ML" }] }],
      ["kebab", { id: "kebab", name: "Kebab", kind: "DISH", yieldQty: 1, yieldUnit: null, lines: [
        { ingredientId: "meat", subRecipeId: null, qty: 150, unit: "G" }, { ingredientId: "pita", subRecipeId: null, qty: 1, unit: "PCS" },
        { ingredientId: "onion", subRecipeId: null, qty: 40, unit: "G" }, { ingredientId: null, subRecipeId: "sauce", qty: 50, unit: "G" },
      ] }],
    ]);
    const sauce = costRecipe("sauce", recs, ings);
    expect(sauce.batchCost).toBe(6.6); // 1.8 kg × 3 + 0.2 l × 6
    expect(sauce.unitCost).toBe(3.3); // per kg made
    const k = costRecipe("kebab", recs, ings);
    // meat 0.15 / 0.75 × 9 = 1.8; pita 0.25; onion 0.04 / 0.8 × 1.2 = 0.06; sauce 0.05 × 3.3 = 0.165
    expect(k.unitCost).toBe(2.275);
    expect(k.allergens).toEqual(["GLUTEN", "MILK"]);
    expect(k.co2PerUnit).toBeCloseTo(0.2 * 20 + 0.1 + 0.05 * 0.5 + 0.05 * ((1.8 * 2 + 0.2 * 3) / 2), 4);
    expect(foodCostPct(k.unitCost, 8.5, 13)).toBe(30.2); // 8.50 incl. 13 % VAT = 7.52 net
    expect(marginOf(k.unitCost, 8.5, 13)).toBe(5.25);
    expect(suggestPrice(k.unitCost, 25, 13, "0.10")).toBe(10.3);
    expect(costRecipe("kebab", recs, new Map([...ings, ["meat", ing("meat", "KG", null)]])).missing).toBe(1);
  });

  it("refuses recipe loops", () => {
    const recs = new Map<string, RecipeLite>([
      ["a", { id: "a", name: "A", kind: "SUB", yieldQty: 1, yieldUnit: "KG", lines: [{ ingredientId: null, subRecipeId: "b", qty: 1, unit: "KG" }] }],
      ["b", { id: "b", name: "B", kind: "SUB", yieldQty: 1, yieldUnit: "KG", lines: [] }],
    ]);
    expect(makesCycle("b", "a", recs)).toBe(true); // b would use a, which uses b
    expect(makesCycle("a", "b", recs)).toBe(false);
    recs.get("b")!.lines.push({ ingredientId: null, subRecipeId: "a", qty: 1, unit: "KG" });
    expect(costRecipe("a", recs, new Map()).cycle || costRecipe("a", recs, new Map()).missing > 0).toBe(true);
  });

  it("rounds prices up to the house style", () => {
    expect(roundPrice(8.42, "0.10")).toBe(8.5);
    expect(roundPrice(8.5, "0.10")).toBe(8.5);
    expect(roundPrice(8.42, "0.50")).toBe(8.5);
    expect(roundPrice(8.42, "0.05")).toBe(8.45);
    expect(roundPrice(8.42, "X.90")).toBe(8.9);
    expect(roundPrice(8.95, "X.90")).toBe(9.9);
    expect(roundPrice(8.427, "NONE")).toBe(8.43);
  });

  it("what if an ingredient gets dearer", () => {
    const r = whatIf([{ id: "k", name: "Kebab", cost: 2, ingredientShare: 1, priceGross: 7.91, vatRate: 13, targetPct: 30 }, { id: "s", name: "Salad", cost: 1, ingredientShare: 0, priceGross: 5, vatRate: 13, targetPct: 30 }], 20, "0.10");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cost: 2.2, before: 28.6, after: 31.4, over: true, suggested: 8.3 });
  });

  it("menu engineering: stars, plough-horses, puzzles, dogs", () => {
    const e = engineer([
      { id: "a", name: "Kebab", sold: 400, margin: 5 }, { id: "b", name: "Falafel", sold: 300, margin: 2 },
      { id: "c", name: "Lamb", sold: 40, margin: 9 }, { id: "d", name: "Soup", sold: 30, margin: 1.5 }, { id: "x", name: "Unpriced", sold: 99, margin: null },
    ]);
    expect(e.popularAt).toBe(17.5);
    const cls = Object.fromEntries(e.items.map((i) => [i.id, i.cls]));
    expect(cls).toEqual({ a: "STAR", b: "PLOWHORSE", c: "PUZZLE", d: "DOG" });
    expect(engineer([]).items).toEqual([]);
  });

  it("waste totals, share of purchases, weekly chart, order less", () => {
    const at = (d: string) => new Date(`2026-${d}T12:00:00Z`);
    const s = wasteSummary([
      { at: at("11-18"), reason: "EXPIRED", label: "Milk", ingredientId: "m", cost: 6, kg: 4, co2: 5 },
      { at: at("11-19"), reason: "EXPIRED", label: "Milk", ingredientId: "m", cost: 3, kg: 2, co2: 2.5 },
      { at: at("11-19"), reason: "PLATE_WASTE", label: "Fries", ingredientId: null, cost: 1, kg: 0.5, co2: null },
    ], 250);
    expect(s).toMatchObject({ cost: 10, kg: 6.5, co2: 7.5, count: 3, pctOfPurchases: 4 });
    expect(s.byReason[0]).toMatchObject({ reason: "EXPIRED", cost: 9, count: 2 });
    expect(s.byItem[0]).toMatchObject({ label: "Milk", cost: 9 });
    const w = weeklyWaste([{ at: at("11-18"), cost: 6 }, { at: at("11-10"), cost: 2 }], at("11-20"), 3);
    expect(w).toEqual([{ week: "2026-11-02", cost: 0 }, { week: "2026-11-09", cost: 2 }, { week: "2026-11-16", cost: 6 }]);
    const o = orderLess([
      { ingredientId: "m", name: "Milk", wasteEntries: 4, wastedQty: 6, boughtQty: 40, reasons: ["EXPIRED"] },
      { ingredientId: "f", name: "Fries", wasteEntries: 5, wastedQty: 3, boughtQty: 50, reasons: ["PLATE_WASTE"] },
      { ingredientId: "b", name: "Bread", wasteEntries: 1, wastedQty: 2, boughtQty: 10, reasons: ["SPOILED"] },
    ], 3);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ ingredientId: "m", cutPct: 15 });
    expect(daysUntil(at("11-22"), at("11-20"))).toBe(2);
  });

  it("settings: defaults and limits", () => {
    const m = mergeKitchenSettings({ targetFoodCostPct: 28, rounding: "bad" as never, types: { WHOLESALER: true } as never });
    expect(m.targetFoodCostPct).toBe(28);
    expect(m.rounding).toBe("0.10");
    expect(m.types).toEqual({ CUSTOMER: true, WHOLESALER: true });
    expect(() => cleanKitchenSettings({ ...D, targetFoodCostPct: 2 })).toThrow(/Target/);
    expect(() => cleanKitchenSettings({ ...D, useFirstDays: 30 })).toThrow(/Use-first/);
    expect(cleanKitchenSettings(D).wasteTargetPct).toBe(4);
  });
});
