/**
 * Phase 61: wholesaler storefronts — the supplier builds and publishes its page, FIRINGI approves / suspends,
 * the public page shows delivery terms (minimum order, free delivery from, fee) and public offers (never prices,
 * never offers meant for chosen customers), registrations from the link are linked to the store.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as S from "@/server/storefront/service";
import { ctxFor, makeApprovedCompany } from "../helpers";

const LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test", KB = "owner@kebabhouse.test";
let lxId = "", promoPublic = "", promoTargeted = "", offerId = "";

beforeAll(async () => {
  const lx = await ctxFor(LX);
  lxId = lx.company.id;
  offerId = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } })).id;
  const pt = await prisma.country.findFirstOrThrow({ where: { code: "PT" } });
  const kb = await ctxFor(KB);
  promoPublic = (await prisma.promotion.create({ data: { ownerType: "VENDOR", ownerCompanyId: lxId, name: { en: "Storefront test 10 % off", pt: "Teste loja 10 %" }, kind: "PERCENT", value: 10, countryId: pt.id, validFrom: new Date(Date.now() - 86400_000), status: "ACTIVE", targets: { create: [{ offerId }] } } })).id;
  promoTargeted = (await prisma.promotion.create({ data: { ownerType: "VENDOR", ownerCompanyId: lxId, name: { en: "Only for Kebab" }, kind: "PERCENT", value: 20, validFrom: new Date(Date.now() - 86400_000), status: "ACTIVE", targets: { create: [{ buyerCompanyId: kb.company.id }] } } })).id;
});
beforeEach(async () => {
  await prisma.setting.deleteMany({ where: { key: "storefront.settings" } });
});
afterAll(async () => {
  await prisma.promotion.deleteMany({ where: { id: { in: [promoPublic, promoTargeted] } } });
  await prisma.storefront.deleteMany({ where: { companyId: lxId } });
  await prisma.setting.deleteMany({ where: { key: "storefront.settings" } });
  await prisma.$disconnect();
});

describe("storefronts", () => {
  it("the supplier saves and asks to publish; FIRINGI approves; the public page shows delivery and offers", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    await prisma.storefront.deleteMany({ where: { companyId: lxId } });
    const mine = await S.myStorefront(lx);
    expect(mine.store.exists).toBe(false);
    expect(mine.store.slug).toMatch(/^lisboa-central/);
    expect(mine.qr).toMatch(/^data:image\/png;base64,/);
    await expect(S.saveStorefront(lx, { slug: "admin" })).rejects.toThrow(/reserved/);
    await expect(S.saveStorefront(lx, { slug: "Bad Name" })).rejects.toThrow(/letters/);
    await S.saveStorefront(lx, { slug: "lisboa-central-test", tagline: "Fresh every morning", about: "Family wholesaler since 1987.", accent: "#be185d", featuredOfferIds: [offerId] });

    // not published → nobody outside sees it; the owner may preview
    expect(await S.publicStorefront("lisboa-central-test", null, "en")).toBeNull();
    expect((await S.publicStorefront("lisboa-central-test", lx, "en"))?.preview).toBe(true);

    expect(await S.publishStorefront(lx)).toBe("PENDING");
    expect(await S.publicStorefront("lisboa-central-test", null, "en")).toBeNull();
    expect(await S.decideStorefront(sa, lxId, "APPROVE")).toBe("PUBLISHED");

    const p = (await S.publicStorefront("lisboa-central-test", null, "en"))!;
    expect(p.store).toMatchObject({ name: expect.any(String), tagline: "Fresh every morning", accent: "#be185d", type: "WHOLESALER" });
    expect(p.registerPath).toBe("/register/customer?store=lisboa-central-test");
    expect(p.products[0]).toMatchObject({ offerId, featured: true });
    expect(JSON.stringify(p.products)).not.toMatch(/price/i);
    // delivery terms from the same rules checkout uses
    const rules = await prisma.deliveryRule.findFirst({ where: { scope: "COUNTRY", isActive: true, country: { code: "PT" } }, orderBy: { priority: "desc" } });
    if (rules?.minOrderValue != null) expect(p.delivery.minOrder).toBe(Number(rules.minOrderValue));
    const vr = await prisma.deliveryRule.findFirst({ where: { scope: "VENDOR", vendorCompanyId: lxId, isActive: true }, orderBy: { priority: "desc" } });
    if (vr?.vendorDeliveryMinimum != null && vr.vendorMinimumKind === "AMOUNT") expect(p.delivery.freeFrom).toBe(Number(vr.vendorDeliveryMinimum));
    // public offers only — never one made for chosen customers
    expect(p.offers.promotions.some((x) => x.id === promoPublic && x.value === 10 && x.products.length === 1)).toBe(true);
    expect(p.offers.promotions.some((x) => x.id === promoTargeted)).toBe(false);
    // the buyer's shop page shows the same branding, delivery and offers
    const b = (await S.shopBranding(lxId, "en"))!;
    expect(b).toMatchObject({ published: true, slug: "lisboa-central-test", tagline: "Fresh every morning" });
    expect(b.offers.promotions.some((x) => x.id === promoPublic)).toBe(true);
  });

  it("visits and registrations from the link are counted; the right account type is linked once", async () => {
    const lx = await ctxFor(LX);
    const before = (await S.myStorefront(lx)).stats;
    await S.countView(lxId);
    const customer = await makeApprovedCompany("CUSTOMER");
    expect(await S.attachStorefrontSignup(customer.companyId, "lisboa-central-test")).toBe(true);
    expect(await S.attachStorefrontSignup(customer.companyId, "lisboa-central-test")).toBe(false);
    const wholesaler = await makeApprovedCompany("WHOLESALER");
    expect(await S.attachStorefrontSignup(wholesaler.companyId, "lisboa-central-test")).toBe(false);
    expect(await S.attachStorefrontSignup(customer.companyId, "no-such-store")).toBe(false);
    const after = (await S.myStorefront(lx)).stats;
    expect(after.views30).toBe(before.views30 + 1);
    expect(after.signups30).toBe(before.signups30 + 1);
    expect(after.customers).toBe(before.customers + 1);
    const home = await S.myHomeStore(await ctxFor(customer.email));
    expect(home).toMatchObject({ companyId: lxId, slug: "lisboa-central-test" });
  });

  it("FIRINGI suspends / restores; switches off; refuses customers and other suppliers", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA), kb = await ctxFor(KB);
    await expect(S.decideStorefront(sa, lxId, "SUSPEND")).rejects.toThrow(/reason/);
    expect(await S.decideStorefront(sa, lxId, "SUSPEND", "Misleading claims")).toBe("SUSPENDED");
    expect(await S.publicStorefront("lisboa-central-test", null, "en")).toBeNull();
    await expect(S.publishStorefront(lx)).rejects.toThrow(/suspended/);
    expect(await S.decideStorefront(sa, lxId, "RESTORE")).toBe("PUBLISHED");
    expect(await S.publicStorefront("lisboa-central-test", null, "en")).not.toBeNull();
    // already approved once: taking it offline and back needs no new approval
    await S.unpublishStorefront(lx);
    expect(await S.publishStorefront(lx)).toBe("PUBLISHED");
    // FIRINGI switches storefronts off: public page gone, publishing refused
    await S.saveStorefrontSettings(sa, { enabled: false });
    expect(await S.publicStorefront("lisboa-central-test", null, "en")).toBeNull();
    expect(await S.shopBranding(lxId, "en")).toBeNull();
    await S.saveStorefrontSettings(sa, { enabled: true, publicProducts: false });
    const p = (await S.publicStorefront("lisboa-central-test", null, "en"))!;
    expect(p.showProducts).toBe(false);
    expect(p.products.length).toBe(0);
    expect((await S.publicStorefront("lisboa-central-test", kb, "en"))!.products.length).toBeGreaterThan(0);
    await expect(S.myStorefront(kb)).rejects.toThrow();
    await expect(S.decideStorefront(lx, lxId, "APPROVE")).rejects.toThrow();
    expect((await S.adminStorefronts(sa)).items.some((x) => x.companyId === lxId)).toBe(true);
  });
});
