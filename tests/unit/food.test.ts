import { describe, expect, it } from "vitest";
import {
  activeFields, ALLERGENS, allergenLists, blocking, completeness, DEFAULT_FOOD_SETTINGS, diffFood, effectiveFields, ingredientSegments, mergeFoodSettings,
  missingFields, notable, pickLang, problems, profileHits, type FoodData,
} from "@/lib/food";
import { mapHeaders, parseLevel } from "@/server/food/import";

const FREE = Object.fromEntries(ALLERGENS.map((a) => [a, "FREE"])) as FoodData["allergens"];
const base = (o: Partial<FoodData> = {}): FoodData => ({
  allergens: { ...FREE, GLUTEN: "CONTAINS" }, ingredients: { pt: "Farinha de *trigo*, água" },
  nutrition: { basis: "100g", energyKj: 1046, energyKcal: 250, fat: 1, saturates: 0.2, carbohydrate: 50, sugars: 2, protein: 8, salt: 1 },
  diets: [], originCountryCode: "PT", storage: { pt: "Local seco" }, shelfLifeDays: 180, afterOpeningDays: null, ...o,
});

describe("food information rules", () => {
  it("completeness: every allergen stated, ingredients, the 7 mandatory nutrients, origin, storage", () => {
    const fields = ["ALLERGENS", "INGREDIENTS", "NUTRITION", "ORIGIN", "STORAGE"] as const;
    expect(missingFields(base(), [...fields])).toEqual([]);
    expect(completeness(base(), [...fields])).toBe(100);
    const { MILK: _m, ...partial } = base().allergens;
    expect(missingFields(base({ allergens: partial }), ["ALLERGENS"])).toEqual(["ALLERGENS"]);
    expect(missingFields(base({ nutrition: { basis: "100g", energyKj: 10 } }), ["NUTRITION"])).toEqual(["NUTRITION"]);
    expect(missingFields(base({ ingredients: { pt: "  " } }), ["INGREDIENTS"])).toEqual(["INGREDIENTS"]);
    expect(completeness(null, ["ALLERGENS"])).toBe(0);
    expect(completeness(null, [])).toBe(100);
    expect(missingFields(base(), ["LABEL_PHOTO"])).toEqual(["LABEL_PHOTO"]);
    expect(missingFields(base({ hasLabel: true }), ["LABEL_PHOTO"])).toEqual([]);
  });

  it("checks: nutrition that can't be right, claims that contradict the allergens", () => {
    expect(blocking(problems(base()))).toEqual([]);
    const codes = (d: FoodData) => problems(d).map((p) => p.code);
    expect(codes(base({ nutrition: { ...base().nutrition!, saturates: 5 } }))).toContain("SATURATES_GT_FAT");
    expect(codes(base({ nutrition: { ...base().nutrition!, sugars: 60 } }))).toContain("SUGARS_GT_CARBS");
    expect(codes(base({ nutrition: { ...base().nutrition!, energyKj: 2000 } }))).toContain("ENERGY_MISMATCH");
    expect(codes(base({ diets: ["GLUTEN_FREE"] }))).toContain("GLUTEN_FREE_CONFLICT");
    expect(codes(base({ diets: ["VEGAN"], allergens: { ...FREE, MILK: "CONTAINS" } }))).toContain("VEGAN_CONFLICT");
    expect(codes(base({ ingredients: { pt: "Farinha de *trigo, água" } }))).toContain("UNBALANCED_STARS");
    // a halal claim without its certificate is a warning, not a block
    const w = problems(base({ diets: ["HALAL"], certificates: [] }));
    expect(w.map((p) => p.code)).toContain("NO_CERTIFICATE");
    expect(blocking(w)).toEqual([]);
  });

  it("category requirements: nearest category that says something; root without = not food; parts switched off are not required", () => {
    expect(effectiveFields([{ foodRequirements: null }, { foodRequirements: { fields: ["ALLERGENS", "NUTRITION"] } }])).toEqual(["ALLERGENS", "NUTRITION"]);
    expect(effectiveFields([{ foodRequirements: { fields: [] } }, { foodRequirements: { fields: ["ALLERGENS"] } }])).toEqual([]);
    expect(effectiveFields([{ foodRequirements: null }])).toBeNull();
    const s = mergeFoodSettings({ parts: { nutrition: false } });
    expect(activeFields(["ALLERGENS", "NUTRITION", "STORAGE"], s)).toEqual(["ALLERGENS", "STORAGE"]);
  });

  it("settings: defaults (required-to-sell and the profile off), cleaning", () => {
    expect(mergeFoodSettings(null)).toEqual(DEFAULT_FOOD_SETTINGS);
    expect(DEFAULT_FOOD_SETTINGS.requireToSell).toBe(false);
    expect(DEFAULT_FOOD_SETTINGS.profile).toBe(false);
    const s = mergeFoodSettings({ alertDays: 5, certReminderDays: [7, 30, 999, 7], review: "yes" });
    expect(s.alertDays).toBe(365);
    expect(s.certReminderDays).toEqual([30, 7]);
    expect(s.review).toBe(true);
  });

  it("recipe changes: added allergens and new ingredients are worth telling; a nutrition tweak alone is not", () => {
    const prev = base();
    expect(diffFood(prev, base())).toBeNull();
    const d = diffFood(prev, base({ allergens: { ...prev.allergens, NUTS: "MAY_CONTAIN" } }))!;
    expect(d.mayContainAdded).toEqual(["NUTS"]);
    expect(notable(d)).toBe(true);
    const n = diffFood(prev, base({ nutrition: { ...prev.nutrition!, salt: 1.2 } }))!;
    expect(n.nutrition).toBe(true);
    expect(notable(n)).toBe(false);
    expect(diffFood(prev, base({ ingredients: { pt: "Farinha de *trigo*,  água" } }))).toBeNull(); // spaces only
    expect(diffFood(null, prev)).toBeNull();
  });

  it("buyers: allergen lists, profile hits, emphasised ingredients, language fallback", () => {
    const l = allergenLists({ ...FREE, GLUTEN: "CONTAINS", SESAME: "MAY_CONTAIN" });
    expect(l.contain).toEqual(["GLUTEN"]);
    expect(l.mayContain).toEqual(["SESAME"]);
    expect(profileHits({ allergensContain: ["GLUTEN"], allergensMayContain: ["SESAME"] }, ["SESAME", "PEANUTS"], true)).toEqual(["SESAME"]);
    expect(profileHits({ allergensContain: ["GLUTEN"], allergensMayContain: ["SESAME"] }, ["SESAME"], false)).toEqual([]);
    expect(ingredientSegments("Farinha de *trigo*, *leite*.")).toEqual([{ t: "Farinha de " }, { t: "trigo", b: true }, { t: ", " }, { t: "leite", b: true }, { t: "." }]);
    expect(pickLang({ pt: "Olá", en: "Hi" }, "de")?.lang).toBe("en");
    expect(pickLang({ pt: "Olá" }, "pt-PT")?.text).toBe("Olá");
    expect(pickLang({}, "pt")).toBeNull();
  });

  it("import: allergen levels in several languages and GS1 codes; FIRINGI and GS1 headers", () => {
    expect(parseLevel("Contém")).toBe("CONTAINS");
    expect(parseLevel("pode conter")).toBe("MAY_CONTAIN");
    expect(parseLevel("FREE_FROM")).toBe("FREE");
    expect(parseLevel("Spuren")).toBe("MAY_CONTAIN");
    expect(parseLevel("")).toBeNull();
    expect(parseLevel("maybe?")).toBe("BAD");
    const cols = mapHeaders(["sku", "gluten", "allergen:AM", "ingredients_pt", "ingredientStatement:en", "nutrient:ENER-KJO", "energy_kcal", "basis", "origin", "whatever"]);
    expect(cols.map((c) => (c ? `${c.kind}${c.key ? `:${c.key}` : ""}` : null))).toEqual(["sku", "allergen:GLUTEN", "allergen:MILK", "ingredients:pt", "ingredients:en", "nutrient:energyKj", "nutrient:energyKcal", "basis", "origin", null]);
  });
});
