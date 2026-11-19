/**
 * Phase 47e — secondary activity codes, and special goods (tobacco, alcohol, vaping, special categories): only for
 * buyers that said they sell them and have a matching activity code — in the catalogue, the cart and the checkout;
 * FIRINGI's rules and per-company exceptions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { registerCompany } from "@/server/services/registration";
import { updateOwnProfile } from "@/server/services/company";
import * as SP from "@/server/special/service";
import { buyerScope } from "@/server/data/catalogue-buyer";
import { assertItems } from "@/server/excise/service";
import { DEFAULT_SPECIAL_SETTINGS } from "@/lib/special-access";
import { categoryInfo } from "@/server/catalogue/restrictions";
import { ctxFor, freshNif } from "../helpers";

const SA = "superadmin@firingi.test", KH = "owner@kebabhouse.test";
let saved: unknown = null;
let kh = "";
const before: { sells: string[]; declared: boolean; code: string | null; codes: string[] } = { sells: [], declared: false, code: null, codes: [] };

beforeAll(async () => {
  saved = (await prisma.setting.findFirst({ where: { key: "special.access" } }))?.value ?? null;
  await prisma.setting.deleteMany({ where: { key: "special.access" } }); // defaults
  const c = await prisma.company.findFirstOrThrow({ where: { memberships: { some: { user: { email: KH } } } } });
  kh = c.id; Object.assign(before, { sells: c.sellsRestricted, declared: c.restrictedDeclared, code: c.activityCode, codes: c.activityCodes });
});
afterAll(async () => {
  await prisma.company.update({ where: { id: kh }, data: { sellsRestricted: before.sells, restrictedDeclared: before.declared, activityCode: before.code, activityCodes: before.codes } });
  await prisma.specialAccessException.deleteMany({ where: { companyId: kh } });
  await prisma.setting.deleteMany({ where: { key: "special.access" } });
  if (saved) await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: "special.access", value: saved as never } });
  await prisma.$disconnect();
});

async function restrictedOffer(kind: "ALCOHOL" | "TOBACCO") {
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true, restriction: true, isActive: true } });
  const info = categoryInfo(cats);
  const ids = [...info].filter(([, i]) => i.restriction === kind).map(([id]) => id);
  return prisma.vendorOffer.findFirst({ where: { packaging: { variant: { product: { OR: [{ restriction: kind }, { categoryId: { in: ids } }] } } } }, select: { id: true } });
}

describe("secondary activity codes", () => {
  it("given at registration (checked, duplicates dropped), added later by the company; FIRINGI corrects", async () => {
    const nif = await freshNif();
    const base = { type: "CUSTOMER" as const, countryCode: "PT", legalName: `Mercearia ${nif}`, taxId: nif, vatNumber: `PT${nif}`, companyEmail: `m${nif}@test.pt`, phone: "+351910000000", owner: { name: "M", email: `o${nif}@test.pt`, password: "Firingi!2026-test" }, headOffice: { line1: "Rua 1", postalCode: "1100-001", cityName: "Lisboa" } };
    await expect(registerCompany({ ...base, activityCode: "47111", activityCodes: "56301, 123" })).rejects.toThrow(/secondary CAE/);
    const { companyId } = await registerCompany({ ...base, activityCode: "47111", activityCodes: "56301, 47260 56301", sellsRestricted: ["TOBACCO"] });
    const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(c).toMatchObject({ activityCode: "47111", activityCodes: ["56301", "47260"], sellsRestricted: ["TOBACCO"], restrictedDeclared: true });
    const ctx = await ctxFor(base.owner.email);
    await updateOwnProfile(ctx, { email: c.email, addActivityCodes: "47250" });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).activityCodes).toEqual(["56301", "47260", "47250"]);
    // what it may buy: tobacco (declared, 4726 matches), not alcohol (not declared)
    const v = (await SP.specialAccess(companyId)).verdicts;
    expect(v.get("TOBACCO")).toMatchObject({ open: true });
    expect(v.get("ALCOHOL")).toMatchObject({ open: false, reason: "NOT_DECLARED" });
    // the company declares alcohol later → open (4711 / 5630 / 4725 match)
    await SP.setOwnSpecialGoods(ctx, ["TOBACCO", "ALCOHOL"]);
    expect((await SP.specialAccess(companyId)).verdicts.get("ALCOHOL")?.open).toBe(true);
  });
});

describe("special goods in the catalogue, the cart and the checkout", () => {
  it("an older account keeps its access; once it says it sells nothing special, alcohol and tobacco disappear and can't be bought", async () => {
    const ctx = await ctxFor(KH);
    const beer = await restrictedOffer("ALCOHOL");
    expect(beer, "the demo catalogue has an alcoholic drink").toBeTruthy();
    const scope0 = await buyerScope(ctx);
    const before0 = scope0.allowedRestrictions;
    await prisma.company.update({ where: { id: kh }, data: { sellsRestricted: [], restrictedDeclared: true, activityCode: "56101" } });
    const scope1 = await buyerScope(await ctxFor(KH));
    expect(scope1.allowedRestrictions).toEqual([]);
    expect(scope1.browsableCategoryIds.length).toBeLessThanOrEqual(scope0.browsableCategoryIds.length);
    if (beer) await expect(assertItems(kh, [{ offerId: beer.id, qty: 1 }])).rejects.toThrow(/can't buy alcoholic drinks/);
    // a restaurant that sells alcohol: open again (licence rules unchanged)
    await prisma.company.update({ where: { id: kh }, data: { sellsRestricted: ["ALCOHOL"] } });
    const scope2 = await buyerScope(await ctxFor(KH));
    expect(scope2.allowedRestrictions.includes("ALCOHOL")).toBe(before0.includes("ALCOHOL"));
    // wrong activity code (IT services): closed; FIRINGI's exception opens it; removing it closes again
    await prisma.company.update({ where: { id: kh }, data: { activityCode: "62010", activityCodes: [] } });
    expect((await SP.specialAccess(kh)).verdicts.get("ALCOHOL")).toMatchObject({ open: false, reason: "CODE" });
    if (beer) await expect(assertItems(kh, [{ offerId: beer.id, qty: 1 }])).rejects.toThrow(/activity codes/);
    const sa = await ctxFor(SA);
    await expect(SP.setSpecialException(sa, kh, "ALCOHOL", true, "")).rejects.toThrow(/reason/);
    await expect(SP.setSpecialException(ctx, kh, "ALCOHOL", true, "please")).rejects.toThrow();
    await SP.setSpecialException(sa, kh, "ALCOHOL", true, "Licence shown; CAE being updated");
    expect((await SP.specialAccess(kh)).verdicts.get("ALCOHOL")).toMatchObject({ open: true, reason: "EXCEPTION" });
    await SP.setSpecialException(sa, kh, "ALCOHOL", false);
    expect((await SP.specialAccess(kh)).verdicts.get("ALCOHOL")?.open).toBe(false);
  });

  it("FIRINGI's rules: a special category for some activity codes only; switched off = open; only admins edit", async () => {
    const sa = await ctxFor(SA), ctx = await ctxFor(KH);
    // the category of a real, unrestricted product on sale (other tests may add empty categories)
    const any = await prisma.vendorOffer.findFirstOrThrow({ where: { status: "ACTIVE", packaging: { variant: { product: { restriction: null, category: { restriction: null, isActive: true } } } } }, select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } } });
    const cat = await prisma.category.findUniqueOrThrow({ where: { id: any.packaging.variant.product.categoryId } });
    await expect(SP.saveSpecialSettings(ctx, DEFAULT_SPECIAL_SETTINGS)).rejects.toThrow();
    await SP.saveSpecialSettings(sa, { ...DEFAULT_SPECIAL_SETTINGS, rules: [...DEFAULT_SPECIAL_SETTINGS.rules, { id: "pharma", target: `cat:${cat.id}`, label: "Pharmacy", codes: ["4773"], countries: [], mode: "BLOCK", active: true }] });
    await prisma.company.update({ where: { id: kh }, data: { activityCode: "56101", activityCodes: [], sellsRestricted: ["TOBACCO", "ALCOHOL"], restrictedDeclared: true } });
    const scope = await buyerScope(await ctxFor(KH));
    expect(scope.browsableCategoryIds.includes(cat.id)).toBe(false);
    const offer = await prisma.vendorOffer.findFirst({ where: { packaging: { variant: { product: { categoryId: { in: [...categoryInfo(await prisma.category.findMany({ select: { id: true, parentId: true, restriction: true, isActive: true } }))].filter(([id, i]) => id === cat.id || i.ancestors.includes(cat.id)).map(([id]) => id) } } } } }, select: { id: true } });
    expect(offer, "an offer in that category").toBeTruthy();
    await expect(assertItems(kh, [{ offerId: offer!.id, qty: 1 }])).rejects.toThrow(/can't buy this item/);
    await prisma.company.update({ where: { id: kh }, data: { activityCodes: ["47730"] } });
    expect((await buyerScope(await ctxFor(KH))).browsableCategoryIds.includes(cat.id)).toBe(true);
    await SP.saveSpecialSettings(sa, { ...DEFAULT_SPECIAL_SETTINGS, enabled: false });
    await prisma.company.update({ where: { id: kh }, data: { sellsRestricted: [] } });
    expect((await SP.specialAccess(kh)).verdicts.get("TOBACCO")?.open).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "special.settings" } })).toBeGreaterThanOrEqual(2);
  });
});
