/** Add a product by barcode with AI: catalogue hit, open databases (food and non-food) → draft, photos, switches, proposal with food draft. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/server/db";
import { setAiTransportForTests } from "@/server/ai/assistant";
import * as B from "@/server/catalogue/barcode-ai";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
const SUP = "owner@lisboacentral.test";
const created: string[] = [];
let calls = 0;
function fakeAi(input: unknown) {
  calls = 0;
  setAiTransportForTests(async () => { calls++; return { content: [{ type: "tool_use", id: "t", name: "record_product", input }], stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 5 } } as unknown as Anthropic.Beta.Messages.BetaMessage; });
}
const clean = async () => { await prisma.setting.deleteMany({ where: { key: "barcodeAi.settings" } }); B.resetBarcodeAiLimitsForTests(); };

beforeAll(async () => { process.env.OFF_SIMULATE = "1"; await clean(); });
afterAll(async () => {
  setAiTransportForTests(null); await clean();
  for (const id of created) {
    await prisma.vendorOffer.deleteMany({ where: { packaging: { variant: { productId: id } } } });
    await prisma.foodInfo.deleteMany({ where: { productId: id } }).catch(() => null);
    await prisma.product.update({ where: { id }, data: { foodInfoId: null } }).catch(() => null);
    await prisma.packagingUnit.deleteMany({ where: { variant: { productId: id } } });
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } }).catch(() => null);
  }
});

describe("add by barcode", () => {
  it("a barcode already in the catalogue → sell it, no new product", async () => {
    const gtin = (await prisma.productVariant.findFirstOrThrow({ where: { gtin: { not: null }, product: { status: "APPROVED" } }, select: { gtin: true } })).gtin!;
    const r = await B.startFromBarcode(await ctxFor(SUP), gtin);
    expect(r.kind).toBe("catalogue");
  });

  it("food from Open Food Facts → the AI fills a FIRINGI category, allergens, VAT", async () => {
    const cat = await prisma.category.findFirstOrThrow({ where: { name: { path: ["en"], equals: "Oils & Vinegar" } } });
    fakeAi({ barcodeOn: "UNIT", nameEn: "Extra virgin olive oil 750 ml", namePt: "Azeite virgem extra 750 ml", brandName: "Quinta do Vale", categoryId: cat.id, taxCategoryCode: null, restriction: null, uomCode: "UN", unitsPerPack: 1, packName: "Bottle 750 ml", contain: [], mayContain: [], diets: ["ORGANIC"], notes: "" });
    const r = await B.startFromBarcode(await ctxFor(SUP), "5609876543212");
    expect(r.kind).toBe("draft");
    if (r.kind !== "draft") return;
    expect(r.source).toBe("Open Food Facts");
    expect(r.draft).toMatchObject({ nameEn: "Extra virgin olive oil 750 ml", categoryId: cat.id, source: "OFF_AI", diets: ["ORGANIC"] });
    expect(r.draft.taxCategoryId).toBeTruthy(); // the category's default VAT when the AI gives none
    expect(calls).toBe(1);
    expect(r.draft).toMatchObject({ gtin: "5609876543212", unitGtin: "5609876543212", barcodeOn: "UNIT" });
  });

  it("wholesale: a case barcode → the item inside is looked up; case and item barcodes both filled in", async () => {
    fakeAi({ barcodeOn: "PACK", nameEn: "Extra virgin olive oil 750 ml", namePt: "Azeite virgem extra 750 ml", brandName: "Quinta do Vale", categoryId: null, taxCategoryCode: null, restriction: null, uomCode: "UN", unitsPerPack: 6, packName: "Case 6 × 750 ml", contain: [], mayContain: [], diets: [], notes: "" });
    const r = await B.startFromBarcode(await ctxFor(SUP), "15609876543219");
    expect(r.kind).toBe("draft");
    if (r.kind !== "draft") return;
    expect(r.source).toBe("Open Food Facts");
    expect(r.draft).toMatchObject({ gtin: "15609876543219", unitGtin: "5609876543212", barcodeOn: "PACK", unitsPerPack: 6, packName: "Case 6 × 750 ml" });
  });

  it("non-food (cosmetics) from Open Beauty Facts; an invented category id is dropped", async () => {
    fakeAi({ barcodeOn: "UNIT", nameEn: "Shower gel 500 ml", namePt: "Gel de banho 500 ml", brandName: "Brisa", categoryId: "not-a-real-id", taxCategoryCode: "STANDARD", restriction: null, uomCode: "UN", unitsPerPack: 1, packName: "Bottle 500 ml", contain: [], mayContain: [], diets: [], notes: "Check the category." });
    const r = await B.startFromBarcode(await ctxFor(SUP), "5602222333444");
    expect(r.kind === "draft" && r.source).toBe("Open Beauty Facts");
    if (r.kind !== "draft") return;
    expect(r.draft.categoryId).toBeNull();
    expect(r.draft.brandName).toBe("Brisa");
  });

  it("not in any database → photos; the AI reads them", async () => {
    const r = await B.startFromBarcode(await ctxFor(SUP), "4006381333931");
    expect(r).toMatchObject({ kind: "notFound", photos: true });
    fakeAi({ barcodeOn: "PACK", nameEn: "Ballpoint pens, box of 10", namePt: "Esferográficas, caixa de 10", brandName: "", categoryId: null, taxCategoryCode: "STANDARD", restriction: null, uomCode: "CX", unitsPerPack: 10, packName: "Box of 10", contain: [], mayContain: [], diets: [], notes: "" });
    const p = await B.draftFromPhotos(await ctxFor(SUP), "4006381333931", [{ mime: "image/png", base64: "iVBORw0KGgo=" }]);
    expect(p.kind === "draft" && p.draft).toMatchObject({ source: "PHOTOS_AI", unitsPerPack: 10, uomCode: "CX", barcodeOn: "PACK" });
    await expect(B.draftFromPhotos(await ctxFor(SUP), "4006381333931", [{ mime: "application/pdf", base64: "x" }])).rejects.toThrow(/JPG/);
  });

  it("AI switched off → the database facts by rules; bad barcode refused", async () => {
    await B.saveBarcodeAiSettings(await ctxFor(SA), { parts: { lookup: true, ai: false, photos: true } });
    fakeAi({});
    const r = await B.startFromBarcode(await ctxFor(SUP), "5601111222333");
    expect(r.kind === "draft" && r.draft).toMatchObject({ source: "OFF", unitsPerPack: 6, contain: ["GLUTEN", "MILK", "EGGS"], mayContain: ["NUTS"] });
    expect(calls).toBe(0);
    await expect(B.startFromBarcode(await ctxFor(SUP), "5601111222334")).rejects.toThrow(/valid barcode/);
    await B.saveBarcodeAiSettings(await ctxFor(SA), { parts: { lookup: true, ai: true, photos: true } });
  });

  it("FIRINGI's switches: country left out, company override, customers never", async () => {
    const sa = await ctxFor(SA);
    const sup = await ctxFor(SUP);
    await B.saveBarcodeAiSettings(sa, { offCountries: [sup.company.countryCode!] });
    await expect(B.startFromBarcode(sup, "5609876543212")).rejects.toThrow(/switched on/);
    await B.setCompanyBarcodeAi(sa, sup.company.id, "ON");
    expect((await B.barcodeAiAccess(await ctxFor(SUP))).on).toBe(true);
    expect((await B.barcodeAiOverrides(sa)).map((o) => o.id)).toContain(sup.company.id);
    await B.setCompanyBarcodeAi(sa, sup.company.id, "OFF");
    await B.saveBarcodeAiSettings(sa, { offCountries: [] });
    expect((await B.barcodeAiAccess(await ctxFor(SUP))).on).toBe(false);
    await B.setCompanyBarcodeAi(sa, sup.company.id, null);
    await expect(B.startFromBarcode(await ctxFor("owner@kebabhouse.test"), "5609876543212")).rejects.toThrow();
    await expect(B.saveBarcodeAiSettings(sup, { enabled: false })).rejects.toThrow();
  });

  it("the proposal keeps the brand for FIRINGI, saves the food information as a draft; single items with a minimum quantity", async () => {
    const sup = await ctxFor(SUP);
    const cat = await prisma.category.findFirstOrThrow({ where: { name: { path: ["en"], equals: "Oils & Vinegar" } } });
    const tax = await prisma.taxCategory.findFirstOrThrow({ where: { code: "REDUCED" } });
    const svc = await import("@/server/services/vendor-catalogue");
    const r = await svc.proposeProduct(sup, { name: { en: "Barcode AI test oil", pt: "Azeite teste" }, categoryId: cat.id, taxCategoryId: tax.id, gtin: "5609876543212", attributes: { brand: "Quinta do Vale" },
      packaging: { uomCode: "UN", name: { en: "Bottle 750 ml" }, unitsPerPack: 1 }, offer: { minOrderQty: 12, qtyStep: 6, leadTimeDays: 1 } });
    created.push(r.productId);
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { packaging: { variant: { productId: r.productId } } } });
    expect(offer).toMatchObject({ minOrderQty: 12, qtyStep: 6 }); // single bottle barcode, sold from 12, in steps of 6
    await B.saveDraftFoodInfo(sup, r.productId, { contain: ["SULPHITES"], mayContain: [], diets: ["ORGANIC"], ingredients: { pt: "Azeite virgem extra." } });
    const v = await prisma.productVariant.findFirstOrThrow({ where: { productId: r.productId } });
    expect(v.attributes).toMatchObject({ brand: "Quinta do Vale" });
    const fi = await prisma.foodInfo.findFirst({ where: { productId: r.productId } });
    expect(fi?.source).toBe("AI");
  });
});
