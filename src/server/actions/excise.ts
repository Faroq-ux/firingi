"use server";
/** Licensed & excise goods actions (Phase 43). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as S from "@/server/excise/service";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal(""));
const num = z.union([z.number(), z.string().max(20)]).nullable().optional();
const kinds = z.array(z.enum(["ALCOHOL", "TOBACCO", "VAPING", "SUGAR"])).max(4);
const countries = z.array(z.string().max(2)).max(40);
const adminDone = () => { for (const p of ["/admin/settings/excise", "/admin/catalogue/excise", "/admin/customers/licences", "/admin/finance/excise"]) revalidatePath(p); return true; };
const n = (v: unknown) => (v == null || v === "" ? null : Number(String(v).replace(",", ".")));

export const saveExciseSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(),
    kinds: z.object({ ALCOHOL: z.boolean(), TOBACCO: z.boolean(), VAPING: z.boolean(), SUGAR: z.boolean() }),
    licences: z.object({ buyer: z.boolean(), enforcement: z.enum(["BLOCK", "WARN"]), countries: z.record(z.string().length(2), z.object({ buyer: z.boolean().optional(), enforcement: z.enum(["BLOCK", "WARN"]).optional() })), supplier: z.boolean(), reminderDays: z.array(z.number().int()).max(5) }),
    duty: z.object({ show: z.boolean(), calculate: z.boolean() }),
    restrictions: z.object({ countries: z.boolean(), qtyCaps: z.boolean(), driverCheck: z.boolean() }),
    records: z.object({ report: z.boolean(), register: z.boolean(), accounting: z.boolean(), deliveryDocs: z.boolean() }),
  }),
  handler: async (ctx, i) => { await S.saveExciseSettings(ctx, i); return adminDone(); },
});

export const saveExciseCategoryAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id, maxPerOrder: z.number().int().nullable(), blockedCountries: countries, active: z.boolean(), nameEn: z.string().max(80).optional(), namePt: z.string().max(80).optional() }),
  handler: async (ctx, i) => { await S.saveCategory(ctx, i.id, i); return adminDone(); },
});

export const addExciseRateAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ categoryId: id, countryCode: z.string().length(2), rate: num, adValoremPct: num, bands: z.array(z.object({ maxGPerL: z.number().nullable(), perHl: z.number() })).max(10).nullable().optional(), validFrom: z.string(), note: z.string().max(200).nullable().optional() }),
  handler: async (ctx, i) => { await S.addRate(ctx, { ...i, rate: n(i.rate) ?? NaN, adValoremPct: n(i.adValoremPct) }); return adminDone(); },
});

export const setShopCategoryExciseAction = defineAction({
  permission: "admin.catalogue.manage", schema: z.object({ categoryId: id, exciseCategoryId: id.nullable() }),
  handler: async (ctx, i) => { await S.setShopCategoryExcise(ctx, i.categoryId, i.exciseCategoryId); return adminDone(); },
});

export const saveLicenceTypeAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id: id.nullable().optional(), code: z.string().max(30), nameEn: z.string().max(100), namePt: z.string().max(100).nullable().optional(), kinds, countries, needsNumber: z.boolean(), hasExpiry: z.boolean(), active: z.boolean() }),
  handler: async (ctx, i) => { await S.saveLicenceType(ctx, i); return adminDone(); },
});

export const saveOfferExciseAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({ offerId: id, exciseCategoryId: id.nullable().optional(), abv: num, volumeL: num, exciseUnits: num, netKg: num, sugarGPerL: num, dutyMode: z.enum(["PAID", "ADDED"]), exciseCountries: countries.optional() }),
  handler: async (ctx, i) => {
    await S.saveOfferExcise(ctx, { ...i, abv: n(i.abv), volumeL: n(i.volumeL), exciseUnits: n(i.exciseUnits), netKg: n(i.netKg), sugarGPerL: n(i.sugarGPerL) });
    revalidatePath("/vendor/products/excise");
    return true;
  },
});

/** Customer uploads a licence (multipart). */
export async function uploadLicenceAction(fd: FormData) {
  return runAction(async (ctx) => {
    const s = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : null);
    const lid = await S.uploadLicence(ctx, { typeId: s("typeId") ?? "", number: s("number"), issuer: s("issuer"), issuedOn: s("issuedOn") || null, expiresOn: s("expiresOn") || null, file: fd.get("file") as File });
    revalidatePath("/buy/company/licences");
    return { id: lid };
  });
}

export const withdrawLicenceAction = defineAction({
  permission: null, schema: z.object({ id }),
  handler: async (ctx, i) => { await S.withdrawLicence(ctx, i.id); revalidatePath("/buy/company/licences"); return true; },
});

export const reviewLicenceAction = defineAction({
  permission: null,
  schema: z.object({ id, decision: z.enum(["APPROVE", "REJECT", "REVOKE"]), expiresOn: day, note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => {
    if (i.decision === "APPROVE") await S.approveLicence(ctx, i.id, { expiresOn: i.expiresOn || null, note: i.note ?? null });
    else if (i.decision === "REJECT") await S.rejectLicence(ctx, i.id, i.note ?? "");
    else await S.revokeLicence(ctx, i.id, i.note ?? "");
    return adminDone();
  },
});

export const recordLicenceAction = defineAction({
  permission: null,
  schema: z.object({ companyId: id, typeId: id, number: z.string().max(80).nullable().optional(), issuer: z.string().max(120).nullable().optional(), expiresOn: day, note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { await S.recordLicence(ctx, { ...i, expiresOn: i.expiresOn || null }); return adminDone(); },
});

export const recordExciseDocAction = defineAction({
  permission: null, schema: z.object({ orderId: id, docType: z.string().max(10), docRef: z.string().max(60) }),
  handler: async (ctx, i) => {
    await S.recordExciseDoc(ctx, i.orderId, i);
    for (const p of ["/vendor/orders", "/admin/orders", "/buy/orders"]) revalidatePath(p, "layout");
    return true;
  },
});
