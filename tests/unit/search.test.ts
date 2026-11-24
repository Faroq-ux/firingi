/** Smart search rules (Phase 72): normalising, words, filters in the URL, the simulated AI reading. */
import { describe, expect, it } from "vitest";
import { cleanAlternatives, cleanSearchSettings, filterParams, looksLikeSentence, normalize, parseFilters, searchWords } from "@/lib/search";
import { simulatedUnderstanding } from "@/server/search/service";

describe("normalize & words", () => {
  it("lower case, no accents, sizes kept", () => {
    expect(normalize("Açúcar  Branco 1,5 KG")).toBe("acucar branco 1.5 kg");
    expect(normalize("Água Luso 1.5L!")).toBe("agua luso 1.5l");
    expect(normalize("Weißbier Œufs")).toBe("weissbier oeufs");
  });
  it("little words dropped, max 8, no duplicates", () => {
    expect(searchWords("queijo para a pizza do restaurante")).toEqual(["queijo", "pizza", "restaurante"]);
    expect(searchWords("the cheese for the cheese")).toEqual(["cheese"]);
    expect(searchWords("a b c d e f g h i j k l m n o p").length).toBeLessThanOrEqual(8);
  });
  it("sentences vs product words", () => {
    expect(looksLikeSentence("mozzarella")).toBe(false);
    expect(looksLikeSentence("mozzarella under 5")).toBe(true);
    expect(looksLikeSentence("gluten free pasta for kids")).toBe(true);
  });
  it("alternatives cleaned", () => {
    expect(cleanAlternatives("Tomate", ["Tomato", "tomate", "POMODORO", "pomodoro", "x"])).toEqual(["tomato", "pomodoro"]);
  });
});

describe("filters in the URL", () => {
  it("parses and drops junk", () => {
    const f = parseFilters({ max: "7,5", deal: "1", free: ["GLUTEN,MILK", "BOGUS"], diet: "VEGAN", stars: "9", sort: "price", cat: "x'; drop", vendor: "clabc12345678" });
    expect(f).toMatchObject({ max: 7.5, deal: true, free: ["GLUTEN", "MILK"], diet: "VEGAN", stars: null, sort: "price", cat: null, vendor: "clabc12345678" });
    expect(parseFilters({ sort: "weird", max: "-3" })).toMatchObject({ sort: "relevance", max: null });
  });
  it("back to parameters, only those set", () => {
    expect(filterParams({ q: "cheese", max: 5, free: ["GLUTEN"], sort: "relevance", deal: false })).toEqual({ q: "cheese", max: "5", free: "GLUTEN" });
  });
  it("settings are clamped", () => {
    expect(cleanSearchSettings({ typo: 2 }).typo).toBe(0.8);
    expect(cleanSearchSettings({ typo: 0.1, ai: false })).toMatchObject({ typo: 0.3, ai: false, fuzzy: true });
  });
});

describe("simulated AI reading (no AI connected)", () => {
  it("product words, translations and filters", () => {
    const u = simulatedUnderstanding("mozarela sem gluten under 8 euro cheapest");
    expect(u.words.map((w) => w.word)).toEqual(["mozzarella"]);
    expect(u).toMatchObject({ free: ["GLUTEN"], maxPrice: 8, sort: "price", corrected: expect.stringContaining("mozzarella") });
    expect(simulatedUnderstanding("tomate for pizza").words).toEqual([{ word: "tomate", alternatives: expect.arrayContaining(["tomato", "pomodoro"]) }]);
  });
});
