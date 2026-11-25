/** Marketing catalogues: scope (wholesalers / zones / districts), filters, AI (simulated), options, PDF, share link, sending. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as M from "@/server/marketing/catalogues";
import { MC_DEFAULT_OPTIONS, type McOptions } from "@/lib/marketing-catalogue";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
const made: string[] = [];
let pt = "";
const base = (o: Partial<M.McInput> = {}): M.McInput => ({ title: "Test catalogue", subtitle: null, intro: null, locale: "pt-PT", countryId: pt, scope: "ALL", scopeIds: [], filters: { bestSellers: true, max: 12 }, items: [], layout: "GRID6", options: MC_DEFAULT_OPTIONS, ...o });

beforeAll(async () => { process.env.ASSISTANT_SIMULATE = "1"; pt = (await prisma.country.findFirstOrThrow({ where: { code: "PT" } })).id; });
afterAll(async () => {
  await prisma.marketingCatalogue.deleteMany({ where: { id: { in: made } } });
  await prisma.marketingCampaign.deleteMany({ where: { name: { startsWith: "Catalogue: Test" } } });
});

describe("marketing catalogues", () => {
  it("all wholesalers: filled from filters, best sellers, grouped in sections; no tobacco; prices + barcodes as chosen", async () => {
    const sa = await ctxFor(SA);
    const c = await M.createCatalogue(sa, base());
    made.push(c.id);
    const filled = await M.fillByFilters(sa, c.id);
    const items = filled.items as { offerId: string; section: string | null }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(12);
    expect(items[0].section).toBeTruthy();
    const entries = await M.catalogueEntries(filled);
    expect(entries.length).toBe(items.length);
    expect(entries.some((e) => e.priceNet && !e.priceGross)).toBe(false); // net + gross known when VAT is set
    const tob = await prisma.vendorOffer.count({ where: { id: { in: items.map((i) => i.offerId) }, packaging: { variant: { product: { restriction: "TOBACCO" } } } } });
    expect(tob).toBe(0);
    // options: no prices, no barcode
    const plain = await M.updateCatalogue(sa, c.id, { ...base(), items, options: { ...MC_DEFAULT_OPTIONS, price: "NONE", barcode: false } as McOptions });
    const e2 = await M.catalogueEntries(plain);
    expect(e2.every((e) => e.priceNet === null && e.gtin === null)).toBe(true);
  });

  it("one wholesaler: only its products; districts / zones: the wholesalers serving them", async () => {
    const sa = await ctxFor(SA);
    const lc = await prisma.company.findFirstOrThrow({ where: { tradeName: "Lisboa Central" } });
    const c = await M.createCatalogue(sa, base({ scope: "WHOLESALER", scopeIds: [lc.id] }));
    made.push(c.id);
    const list = await M.candidates(c);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x) => x.o.vendorCompanyId === lc.id)).toBe(true);
    const lisboa = await prisma.region.findFirst({ where: { code: "PT-11" } });
    if (lisboa) {
      const d = await M.createCatalogue(sa, base({ scope: "DISTRICT", scopeIds: [lisboa.id] }));
      made.push(d.id);
      expect((await M.scopeVendors(d)).length).toBeGreaterThan(0);
    }
    await expect(M.createCatalogue(sa, base({ scope: "ZONE", scopeIds: [] }))).rejects.toThrow(/zone/);
  });

  it("AI builds it from a brief (simulated): products from the scope only, title and sections", async () => {
    const sa = await ctxFor(SA);
    const c = await M.createCatalogue(sa, base());
    made.push(c.id);
    const r = await M.aiBuild(sa, c.id, "Drinks for cafés, 8 products");
    const items = r.items as { offerId: string }[];
    expect(items.length).toBe(8);
    expect(r.aiPrompt).toContain("Drinks");
    const valid = new Set((await M.candidates(r, 500)).map((x) => x.o.id));
    expect(items.every((i) => valid.has(i.offerId))).toBe(true);
    // a copy in another language
    const en = await M.translateCatalogue(sa, c.id, "en");
    made.push(en.id);
    expect(en.locale).toBe("en");
    expect((en.items as unknown[]).length).toBe(8);
  });

  it("PDF, publish → share link, own PDF, campaign for the scope's customers; only FIRINGI marketing staff", async () => {
    const sa = await ctxFor(SA);
    const c = await M.createCatalogue(sa, base({ title: "Test send" }));
    made.push(c.id);
    const f = await M.fillByFilters(sa, c.id);
    const pdf = await M.cataloguePdf(f);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(await M.publicCatalogue(f.shareToken)).toBeNull(); // not published yet
    await M.setStatus(sa, c.id, "PUBLISHED");
    const pub = await M.publicCatalogue(f.shareToken);
    expect(pub?.id).toBe(c.id);
    expect((await prisma.marketingCatalogue.findUniqueOrThrow({ where: { id: c.id } })).views).toBe(1);
    const sent = await M.campaignFor(sa, c.id);
    expect(sent.customers).toBeGreaterThan(0);
    const camp = await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: sent.campaignId } });
    expect(camp.ctaPath).toBe(`/c/${f.shareToken}`);
    expect(camp.status).toBe("DRAFT");
    await expect(M.createCatalogue(await ctxFor("owner@kebabhouse.test"), base())).rejects.toThrow();
  });
});
