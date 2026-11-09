/**
 * Catalogue visibility & pricing against the real DB with the seeded demo catalogue.
 * Covers checklist items:
 *  - a customer cannot see any distributor or distributor product (even calling the data layer directly)
 *  - a customer without approved tobacco/alcohol access cannot see restricted products
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { browseCatalogue, catalogueItem, visibleSuppliers, browsableCategories } from "@/server/data/catalogue-buyer";
import { requestRestrictionAccess, reviewRestrictionAccess } from "@/server/services/restrictions";
import { createOffer, proposeProduct, setOwnOfferActive, setStock, searchMasterCatalogue } from "@/server/services/vendor-catalogue";
import { ensureBaseList, setPrice, savePriceList, setGroupMember, saveGroup } from "@/server/services/pricing";
import { reviewProduct, saveCategory, reviewOffer } from "@/server/services/catalogue-admin";
import { ctxFor, makeApprovedCompany, pdfFile } from "../helpers";

afterAll(() => prisma.$disconnect());

const KEBAB = "owner@kebabhouse.test";
const LX_BUYER = "purchasing@lisboacentral.test";
const LX_OWNER = "owner@lisboacentral.test";

async function allItems(email: string) {
  const ctx = await ctxFor(email);
  const first = await browseCatalogue(ctx, {});
  const rest = await Promise.all(Array.from({ length: first.pageCount - 1 }, (_, i) => browseCatalogue(ctx, { page: i + 2 })));
  return [first, ...rest].flatMap((p) => p.items);
}
const skus = (items: { sku: string }[]) => new Set(items.map((i) => i.sku));

describe("customer visibility (checklist)", () => {
  it("a customer only ever sees approved wholesalers in its own country", async () => {
    const items = await allItems(KEBAB);
    expect(items.length).toBeGreaterThan(5);
    const vendors = new Set(items.map((i) => i.vendor.name));
    expect([...vendors]).toEqual(["Lisboa Central"]); // not the pending Porto Norte, never a distributor
    const suppliers = await visibleSuppliers(await ctxFor(KEBAB));
    expect(suppliers.map((s) => s.legalName)).toEqual(["Grossista Lisboa Central, Lda"]);
  });

  it("opening a distributor offer directly is refused as 'not found'", async () => {
    const distOffer = await prisma.vendorOffer.findFirstOrThrow({ where: { sellerType: "DISTRIBUTOR", status: "ACTIVE" } });
    await expect(catalogueItem(await ctxFor(KEBAB), distOffer.id)).rejects.toThrow(/not found/);
    // Filtering by a distributor id returns nothing either.
    expect((await browseCatalogue(await ctxFor(KEBAB), { vendorId: distOffer.vendorCompanyId })).total).toBe(0);
  });

  it("a wholesaler in another country is invisible to a Portuguese customer", async () => {
    const es = await makeApprovedCompany("WHOLESALER", "ES");
    const pack = await prisma.packagingUnit.findFirstOrThrow({ where: { variant: { sku: "FIR-COLA33" } } });
    const offer = await prisma.vendorOffer.create({ data: { vendorCompanyId: es.companyId, sellerType: "WHOLESALER", packagingUnitId: pack.id, countryId: (await prisma.company.findUniqueOrThrow({ where: { id: es.companyId } })).countryId, status: "ACTIVE" } });
    const ctxEs = await ctxFor(es.email);
    await setPrice(ctxEs, (await ensureBaseList(ctxEs)).id, offer.id, 1, 1);
    await expect(catalogueItem(await ctxFor(KEBAB), offer.id)).rejects.toThrow(/not found/);
  });

  it("tobacco and alcohol are hidden until approved; approval opens only that category", async () => {
    const before = skus(await allItems(KEBAB));
    for (const s of ["FIR-CIG20", "FIR-SBOCK33", "FIR-DOURO75", "FIR-RUMCAKE"]) expect(before.has(s)).toBe(false);
    const cats = (await browsableCategories(await ctxFor(KEBAB))).map((c) => c.restriction);
    expect(cats.every((r) => r === null)).toBe(true);

    const owner = await ctxFor(KEBAB);
    const req = await requestRestrictionAccess(owner, { restriction: "TOBACCO", licenceNumber: "T-1", issuingAuthority: "AT", file: pdfFile() }).catch(async () =>
      prisma.restrictionApproval.findUniqueOrThrow({ where: { companyId_restriction: { companyId: owner.company.id, restriction: "TOBACCO" } } }),
    );
    if (req.status !== "APPROVED") await reviewRestrictionAccess(await ctxFor("ops@firingi.test"), req.id, "APPROVED", { validUntil: new Date(Date.now() + 86400000 * 30) });

    const after = skus(await allItems(KEBAB));
    expect(after.has("FIR-CIG20")).toBe(true);
    expect(after.has("FIR-SBOCK33")).toBe(false); // alcohol category still hidden
    expect(after.has("FIR-RUMCAKE")).toBe(false); // product-level alcohol restriction still hidden
    await reviewRestrictionAccess(await ctxFor("ops@firingi.test"), req.id, "REVOKED", { note: "test cleanup" });
    expect(skus(await allItems(KEBAB)).has("FIR-CIG20")).toBe(false);
  });

  it("vendors, staff and pending accounts cannot use the buyer catalogue", async () => {
    await expect(browseCatalogue(await ctxFor("owner@atlantico.test"), {})).rejects.toThrow(/permission/);
    await expect(browseCatalogue(await ctxFor("superadmin@firingi.test"), {})).rejects.toThrow(/permission/);
    await expect(browseCatalogue(await ctxFor("owner@minimercadosol.test"), {})).rejects.toThrow(/permission/);
    await expect(browseCatalogue(await ctxFor("warehouse@lisboacentral.test"), {})).rejects.toThrow(/permission/);
  });
});

describe("wholesaler buying", () => {
  it("a wholesaler sees distributors (EU-wide) but never other wholesalers or its own offers", async () => {
    const items = await allItems(LX_BUYER);
    const vendors = [...new Set(items.map((i) => i.vendor.name))].sort();
    expect(vendors).toEqual(["Atlântico", "Ibéricas"]);
    expect(items.some((i) => i.vendor.country.code === "ES")).toBe(true);
  });
});

describe("pricing", () => {
  it("contract and group prices beat base prices for that customer only", async () => {
    const kebab = await allItems(KEBAB);
    const price = (sku: string, items = kebab) => items.find((i) => i.sku === sku && i.packaging.unitsPerPack === 1)!.price!;
    expect(price("FIR-MOZZ2")).toMatchObject({ unitPriceNet: "12.20", scope: "CONTRACT" });
    expect(price("FIR-FARINHA25")).toMatchObject({ unitPriceNet: "18.50", scope: "CUSTOMER_GROUP" });
    expect(price("FIR-AZEITE75")).toMatchObject({ unitPriceNet: "6.40", scope: "BASE" });

    const other = await makeApprovedCompany("CUSTOMER", "PT");
    const otherItems = await allItems(other.email);
    expect(price("FIR-MOZZ2", otherItems)).toMatchObject({ unitPriceNet: "13.50", scope: "BASE" });
    expect(price("FIR-FARINHA25", otherItems)).toMatchObject({ unitPriceNet: "19.90", scope: "BASE" });
  });

  it("shows quantity tiers and per-unit price", async () => {
    const coke = (await allItems(KEBAB)).find((i) => i.sku === "FIR-COLA33" && i.packaging.unitsPerPack === 24)!;
    expect(coke.price!.tiers.map((t) => t.minQty)).toEqual([1, 10, 30]);
    expect(coke.price!.perUnitNet).toBe("0.5792");
    expect(coke.vatRate).toBe("23");
  });

  it("vendor price lists: only eligible buyers, only own offers", async () => {
    const lx = await ctxFor(LX_OWNER);
    const atlanticoOffer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendor: { legalName: "Distribuidora Atlântico, Lda" } } });
    await expect(setPrice(lx, (await ensureBaseList(lx)).id, atlanticoOffer.id, 1, 5)).rejects.toThrow(/not found/);
    const dist = await prisma.company.findFirstOrThrow({ where: { legalName: "Distribuidora Atlântico, Lda" } });
    await expect(savePriceList(lx, { name: "x", scope: "CUSTOMER", targetCompanyId: dist.id })).rejects.toThrow(/can't buy from you/);
    const g = await saveGroup(lx, { name: `G ${Date.now()}` });
    await expect(setGroupMember(lx, g.id, dist.id, true)).rejects.toThrow(/can't buy from you/);
    await expect(setPrice(lx, (await ensureBaseList(lx)).id, (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id } })).id, 1, 0)).rejects.toThrow(/greater than 0/);
  });
});

describe("offer lifecycle", () => {
  it("paused offers, offers without a price and products in review are invisible", async () => {
    const lx = await ctxFor(LX_OWNER);
    const azeite = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, packaging: { variant: { sku: "FIR-AZEITE75" }, unitsPerPack: 1 } } });
    await setOwnOfferActive(lx, azeite.id, false);
    await expect(catalogueItem(await ctxFor(KEBAB), azeite.id)).rejects.toThrow(/not found/);
    await setOwnOfferActive(lx, azeite.id, true);
    expect((await catalogueItem(await ctxFor(KEBAB), azeite.id)).item.sku).toBe("FIR-AZEITE75");

    // New offer without a price → not visible until priced.
    const pack = await prisma.packagingUnit.findFirstOrThrow({ where: { variant: { sku: "FIR-SKIP3L" } } });
    const offer = await createOffer(lx, pack.id, { minOrderQty: 1, qtyStep: 1, leadTimeDays: 1 });
    await expect(createOffer(lx, pack.id, { minOrderQty: 1, qtyStep: 1, leadTimeDays: 1 })).rejects.toThrow(/already offer/);
    await expect(catalogueItem(await ctxFor(KEBAB), offer.id)).rejects.toThrow(/not found/);
    await setPrice(lx, (await ensureBaseList(lx)).id, offer.id, 1, 30);
    expect((await catalogueItem(await ctxFor(KEBAB), offer.id)).item.price!.unitPriceNet).toBe("30.00");

    // Stock: whole numbers, own locations only.
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE" } });
    await setStock(lx, offer.id, wh.id, 12);
    expect((await catalogueItem(await ctxFor(KEBAB), offer.id)).item.available).toBe(12);
    const foreignWh = await prisma.address.findFirstOrThrow({ where: { kind: "WAREHOUSE", company: { legalName: "Distribuidora Atlântico, Lda" } } });
    await expect(setStock(lx, offer.id, foreignWh.id, 5)).rejects.toThrow(/your warehouse/);
    await expect(setStock(await ctxFor("buyer@kebabhouse.test"), offer.id, wh.id, 5)).rejects.toThrow(/permission/);
  });

  it("a proposed product is invisible until FIRINGI approves it; rejection needs a reason", async () => {
    const lx = await ctxFor(LX_OWNER);
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: "spices" } });
    const tax = await prisma.taxCategory.findUniqueOrThrow({ where: { code: "REDUCED" } });
    const { productId, offerId } = await proposeProduct(lx, {
      name: { en: `Kebab spice mix ${Date.now()}`, pt: "Mistura de especiarias" }, categoryId: cat.id, taxCategoryId: tax.id,
      packaging: { uomCode: "CX", name: { en: "Case 12" }, unitsPerPack: 12 }, offer: { minOrderQty: 1, qtyStep: 1, leadTimeDays: 2 },
    });
    await setPrice(lx, (await ensureBaseList(lx)).id, offerId, 1, 24);
    await expect(catalogueItem(await ctxFor(KEBAB), offerId)).rejects.toThrow(/not found/);
    // Other vendors can't attach offers to it while pending.
    expect((await searchMasterCatalogue(await ctxFor("owner@atlantico.test"), "kebab spice mix")).some((p) => p.id === productId)).toBe(false);

    const ops = await ctxFor("ops@firingi.test");
    await expect(reviewProduct(ops, productId, "REJECTED")).rejects.toThrow(/reason/);
    await expect(reviewProduct(await ctxFor("support@firingi.test"), productId, "APPROVED")).rejects.toThrow(/permission/);
    await reviewProduct(ops, productId, "APPROVED");
    expect((await catalogueItem(await ctxFor(KEBAB), offerId)).item.price!.unitPriceNet).toBe("24.00");

    // Admin can suspend the offer.
    await reviewOffer(ops, offerId, "PAUSED", "Label missing PT translation");
    await expect(catalogueItem(await ctxFor(KEBAB), offerId)).rejects.toThrow(/not found/);
    await expect(setOwnOfferActive(lx, offerId, true)).rejects.toThrow(/suspended by FIRINGI/);
  });

  it("deactivating a category hides its whole subtree", async () => {
    const ops = await ctxFor("superadmin@firingi.test");
    const water = await prisma.category.findUniqueOrThrow({ where: { slug: "water" } });
    const bev = await prisma.category.findUniqueOrThrow({ where: { slug: "beverages" } });
    expect(skus(await allItems(KEBAB)).has("FIR-LUSO15")).toBe(true);
    await saveCategory(ops, { id: bev.id, name: bev.name as { en: string }, isActive: false });
    expect(skus(await allItems(KEBAB)).has("FIR-LUSO15")).toBe(false);
    await saveCategory(ops, { id: bev.id, name: bev.name as { en: string }, isActive: true });
    // Moving a category re-roots the paths of its subtree.
    const groceries = await prisma.category.findUniqueOrThrow({ where: { slug: "groceries" } });
    await saveCategory(ops, { id: water.id, name: water.name as { en: string }, parentId: groceries.id, defaultTaxCategoryId: water.defaultTaxCategoryId });
    expect((await prisma.category.findUniqueOrThrow({ where: { id: water.id } })).path).toBe(`${groceries.path}${water.id}/`);
    await expect(saveCategory(ops, { id: bev.id, name: bev.name as { en: string }, parentId: (await prisma.category.findUniqueOrThrow({ where: { slug: "beer" } })).id })).rejects.toThrow(/under itself/);
    await saveCategory(ops, { id: water.id, name: water.name as { en: string }, parentId: bev.id, defaultTaxCategoryId: water.defaultTaxCategoryId });
  });
});

describe("category tree moves", () => {
  it("moving a category carries its whole subtree (paths and depth)", async () => {
    const ops = await ctxFor("superadmin@firingi.test");
    const alc = await prisma.category.findUniqueOrThrow({ where: { slug: "alcoholic-beverages" } });
    const beer = await prisma.category.findUniqueOrThrow({ where: { slug: "beer" } });
    const root = await saveCategory(ops, { name: { en: `Drinks root ${Date.now()}` } });
    const rootRow = await prisma.category.findUniqueOrThrow({ where: { id: root.id } });
    await saveCategory(ops, { id: alc.id, name: alc.name as { en: string }, parentId: root.id, restriction: "ALCOHOL" });
    const movedBeer = await prisma.category.findUniqueOrThrow({ where: { id: beer.id } });
    expect(movedBeer.path).toBe(`${rootRow.path}${alc.id}/${beer.id}/`);
    expect(movedBeer.depth).toBe(2);
    // put it back
    await saveCategory(ops, { id: alc.id, name: alc.name as { en: string }, parentId: alc.parentId, restriction: "ALCOHOL" });
    expect((await prisma.category.findUniqueOrThrow({ where: { id: beer.id } })).path).toBe(beer.path);
  });
});
