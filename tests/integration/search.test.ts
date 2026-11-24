/** Smart search (Phase 72): typo- and accent-tolerant matching, synonyms, the AI's reading with filters, settings. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/server/db";
import { setAiTransportForTests } from "@/server/ai/assistant";
import * as S from "@/server/search/service";
import { searchAcrossSuppliers, browseCatalogue } from "@/server/data/catalogue-buyer";
import { NO_FILTERS } from "@/lib/search";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
const BUYER = "owner@kebabhouse.test";
const names = (r: { items: { name: Record<string, string> }[] }) => r.items.map((i) => i.name.en);
const clean = async () => {
  await prisma.setting.deleteMany({ where: { key: "search.settings" } });
  await prisma.searchSynonym.deleteMany({});
  await prisma.searchUnderstanding.deleteMany({});
};
let calls = 0;
function fakeAi(input: unknown) {
  calls = 0;
  setAiTransportForTests(async () => { calls++; return { content: [{ type: "tool_use", id: "t1", name: "record_search", input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 10 } } as unknown as Anthropic.Beta.Messages.BetaMessage; });
}

beforeAll(clean);
afterAll(async () => { setAiTransportForTests(null); await clean(); });

describe("matching", () => {
  it("finds a product despite a typo, any accents and capitals", async () => {
    const hits = await S.matchProducts([["mozarela"]], { fuzzy: true, typo: 0.5, all: true });
    const ids = hits.map((h) => h.id);
    const mozz = await prisma.product.findFirstOrThrow({ where: { name: { path: ["en"], equals: "Mozzarella block 2kg" } } });
    expect(ids).toContain(mozz.id);
    const ctx = await ctxFor(BUYER);
    expect(names(await searchAcrossSuppliers(ctx, "MOZARELA"))).toContain("Mozzarella block 2kg");
    expect(names(await searchAcrossSuppliers(ctx, "agua luso"))).toContain("Luso still water 1.5L"); // "água" in the text
    expect(names(await searchAcrossSuppliers(ctx, "Água"))).toContain("Luso still water 1.5L");
  });

  it("fuzzy off: exact words only", async () => {
    await S.saveSearchSettings(await ctxFor(SA), { fuzzy: false });
    expect(names(await searchAcrossSuppliers(await ctxFor(BUYER), "mozarela"))).not.toContain("Mozzarella block 2kg");
    await S.saveSearchSettings(await ctxFor(SA), { fuzzy: true });
  });

  it("most words when nothing has them all (partial)", async () => {
    const r = await searchAcrossSuppliers(await ctxFor(BUYER), "mozzarella unicorn", null, { filters: NO_FILTERS });
    expect(names(r)).toContain("Mozzarella block 2kg");
    expect(r.meta?.partial).toBe(true);
  });

  it("the shop browse uses the same matching", async () => {
    const r = await browseCatalogue(await ctxFor(BUYER), { q: "mozarela" });
    expect(r.items.map((i) => i.name.en)).toContain("Mozzarella block 2kg");
  });
});

describe("synonyms", () => {
  it("FIRINGI's synonyms work both ways; switched off → gone", async () => {
    const sa = await ctxFor(SA);
    await S.saveSynonym(sa, { term: "Water", alternatives: ["acqua", "Wasser"] });
    const buyer = await ctxFor(BUYER);
    expect(names(await searchAcrossSuppliers(buyer, "acqua"))).toContain("Luso still water 1.5L");
    expect(names(await searchAcrossSuppliers(buyer, "wasser"))).toContain("Luso still water 1.5L");
    await S.saveSearchSettings(sa, { synonyms: false });
    expect(names(await searchAcrossSuppliers(buyer, "acqua"))).not.toContain("Luso still water 1.5L");
    await S.saveSearchSettings(sa, { synonyms: true });
    await expect(S.saveSynonym(sa, { term: "water", alternatives: ["eau"] })).rejects.toThrow(/already/);
    await expect(S.saveSynonym(await ctxFor(BUYER), { term: "x", alternatives: ["y"] })).rejects.toThrow();
  });
});

describe("the AI reads the query", () => {
  it("words in other languages, filters it understood, cached, learnt as synonyms", async () => {
    fakeAi({ words: [{ word: "Queijo", alternatives: ["mozzarella", "cheese", "queso"] }], free: [], diet: null, maxPrice: 1000, onDeal: false, sort: "price", corrected: null });
    const buyer = await ctxFor(BUYER);
    const r = await searchAcrossSuppliers(buyer, "queijo barato até 1000 euros", null, { ai: true, filters: NO_FILTERS, locale: "pt-PT" });
    expect(names(r)).toContain("Mozzarella block 2kg");
    expect(r.meta?.aiApplied).toEqual(expect.arrayContaining(["max", "sort"]));
    expect(r.meta?.applied).toMatchObject({ max: 1000, sort: "price" });
    expect(calls).toBe(1);
    await searchAcrossSuppliers(buyer, "Queijo  barato até 1000 euros", null, { ai: true, locale: "pt-PT" });
    expect(calls).toBe(1); // same query (normalised) → from the cache
    const syn = await prisma.searchSynonym.findUniqueOrThrow({ where: { term: "queijo" } });
    expect(syn).toMatchObject({ source: "AI" });
    expect(syn.alternatives).toEqual(expect.arrayContaining(["mozzarella", "cheese"]));
    // without AI the learnt synonym still helps
    expect(names(await searchAcrossSuppliers(buyer, "queijo"))).toContain("Mozzarella block 2kg");
    // the buyer turns the AI's filters off
    const plain = await searchAcrossSuppliers(buyer, "queijo barato até 1000 euros", null, { ai: true, aiFilters: false, locale: "pt-PT" });
    expect(plain.meta?.aiApplied).toEqual([]);
  });

  it("never overwrites FIRINGI's own synonyms; AI switched off → no call", async () => {
    const sa = await ctxFor(SA);
    await S.saveSynonym(sa, { term: "tomate", alternatives: ["tomato"] });
    fakeAi({ words: [{ word: "tomate", alternatives: ["pomodoro", "tomaten"] }], free: [], diet: null, maxPrice: null, onDeal: false, sort: null, corrected: null });
    await searchAcrossSuppliers(await ctxFor(BUYER), "tomate", null, { ai: true, locale: "pt-PT" });
    expect((await prisma.searchSynonym.findUniqueOrThrow({ where: { term: "tomate" } })).alternatives).toEqual(["tomato"]);
    await S.saveSearchSettings(sa, { ai: false });
    fakeAi({ words: [], free: [], diet: null, maxPrice: null, onDeal: false, sort: null, corrected: null });
    await searchAcrossSuppliers(await ctxFor(BUYER), "something new", null, { ai: true });
    expect(calls).toBe(0);
    await S.saveSearchSettings(sa, { ai: true });
  });

  it("a broken AI answer → plain search", async () => {
    fakeAi({ words: "nonsense" });
    const r = await searchAcrossSuppliers(await ctxFor(BUYER), "mozzarella block", null, { ai: true });
    expect(names(r)).toContain("Mozzarella block 2kg");
    expect(r.meta?.understood).toBeNull();
  });
});
