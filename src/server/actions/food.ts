"use server";
/** Food information & allergens actions (Phase 44). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as S from "@/server/food/service";
import { importFood } from "@/server/food/import";
import { readLabel } from "@/server/food/label-ai";
import { ALLERGENS, DIETS, FIELDS, LEVELS, NUTRIENTS } from "@/lib/food";

const id = z.string().min(1).max(64);
const level = z.enum(LEVELS).nullable();
const text = z.record(z.string().max(10), z.string().max(5000).nullable());
const num = z.union([z.number(), z.string().max(20)]).nullable().optional();
const vendorDone = (productId: string) => { revalidatePath("/vendor/products/food"); revalidatePath(`/vendor/products/food/${productId}`); return true; };
const adminDone = () => { for (const p of ["/admin/settings/food", "/admin/catalogue/food-review", "/admin/catalogue/food-quality"]) revalidatePath(p); return true; };

const foodInput = z.object({
  allergens: z.object(Object.fromEntries(ALLERGENS.map((a) => [a, level.optional()])) as Record<(typeof ALLERGENS)[number], z.ZodOptional<typeof level>>),
  allergenDetail: z.record(z.string().max(20), z.string().max(200).nullable()).optional(),
  ingredients: text,
  nutrition: z.object({ basis: z.enum(["100g", "100ml"]), ...Object.fromEntries(NUTRIENTS.map((n) => [n, num])) }).nullable(),
  diets: z.array(z.enum(DIETS)).max(DIETS.length),
  originCountryCode: z.string().max(2).nullable(),
  storage: text,
  shelfLifeDays: num,
  afterOpeningDays: num,
});

export const saveFoodDraftAction = defineAction({
  permission: null, schema: z.object({ productId: id, data: foodInput }),
  handler: async (ctx, i) => { const v = await S.saveFoodDraft(ctx, i.productId, i.data as S.FoodInput); vendorDone(i.productId); return v; },
});

export const submitFoodAction = defineAction({
  permission: null, schema: z.object({ productId: id, data: foodInput.optional() }),
  handler: async (ctx, i) => {
    if (i.data) await S.saveFoodDraft(ctx, i.productId, i.data as S.FoodInput);
    const r = await S.submitFood(ctx, i.productId);
    vendorDone(i.productId); adminDone();
    return r;
  },
});

export const withdrawFoodAction = defineAction({
  permission: null, schema: z.object({ productId: id }),
  handler: async (ctx, i) => { await S.withdrawFood(ctx, i.productId); return vendorDone(i.productId); },
});

export async function uploadFoodFileAction(fd: FormData) {
  return runAction(async (ctx) => {
    const productId = String(fd.get("productId") ?? "");
    const kind = fd.get("kind") === "SPEC" ? "SPEC" : "LABEL";
    const r = await S.uploadFoodFile(ctx, productId, kind, fd.get("file") as File);
    vendorDone(productId);
    return r;
  });
}

export async function addFoodCertificateAction(fd: FormData) {
  return runAction(async (ctx) => {
    const s = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : null);
    const productId = s("productId") ?? "";
    const file = fd.get("file");
    const r = await S.saveCertificate(ctx, productId, { diet: s("diet") ?? "", number: s("number"), issuer: s("issuer"), expiresOn: s("expiresOn") || null, file: file instanceof File && file.size ? file : null });
    vendorDone(productId);
    return r;
  });
}

export const removeFoodCertificateAction = defineAction({
  permission: null, schema: z.object({ id, productId: id }),
  handler: async (ctx, i) => { await S.removeCertificate(ctx, i.id); return vendorDone(i.productId); },
});

export const readLabelAction = defineAction({
  permission: null, schema: z.object({ productId: id }),
  handler: async (ctx, i) => { const r = await readLabel(ctx, i.productId); vendorDone(i.productId); return r; },
});

export async function importFoodAction(fd: FormData) {
  return runAction(async (ctx) => {
    const r = await importFood(ctx, { file: fd.get("file") as File, apply: fd.get("apply") === "1", submit: fd.get("submit") === "1" });
    if (r.applied) { revalidatePath("/vendor/products/food"); adminDone(); }
    return r;
  });
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export const reviewFoodAction = defineAction({
  permission: "admin.catalogue.approve",
  schema: z.object({ id, decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(1000).nullable().optional() }),
  handler: async (ctx, i) => {
    const r = i.decision === "APPROVE" ? await S.approveFood(ctx, i.id, i.note ?? null) : (await S.rejectFood(ctx, i.id, i.note ?? ""), { id: i.id, status: "REJECTED" as const, changed: false, allergenAdded: false });
    adminDone(); revalidatePath(`/admin/catalogue/food-review/${i.id}`);
    return r;
  },
});

export const saveFoodSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(),
    parts: z.object({ allergens: z.boolean(), ingredients: z.boolean(), nutrition: z.boolean(), diets: z.boolean(), origin: z.boolean() }),
    review: z.boolean(), requireToSell: z.boolean(), import: z.boolean(), ai: z.boolean(),
    badges: z.boolean(), filter: z.boolean(), sheet: z.boolean(), changeAlerts: z.boolean(), alertDays: z.number().int(),
    profile: z.boolean(), publicPage: z.boolean(), export: z.boolean(), recallLink: z.boolean(), certReminderDays: z.array(z.number().int()).max(5),
  }),
  handler: async (ctx, i) => { await S.saveFoodSettings(ctx, i); return adminDone(); },
});

export const saveFoodRequirementsAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ categoryId: id, fields: z.array(z.enum(FIELDS)).max(FIELDS.length).nullable() }),
  handler: async (ctx, i) => { await S.saveCategoryRequirements(ctx, i.categoryId, i.fields); return adminDone(); },
});

export const allergenRecallAction = defineAction({
  permission: null,
  schema: z.object({ offerId: id, lotCode: z.string().max(80), allergen: z.enum(ALLERGENS), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await S.startAllergenRecall(ctx, i); revalidatePath("/admin/inventory/recalls"); return r; },
});

// ── customers ───────────────────────────────────────────────────────────────

export const saveFoodProfileAction = defineAction({
  permission: null,
  schema: z.object({ avoid: z.array(z.enum(ALLERGENS)).max(14), includeTraces: z.boolean(), hideInCatalogue: z.boolean() }),
  handler: async (ctx, i) => { await S.saveProfile(ctx, i); revalidatePath("/buy/catalogue/allergens"); revalidatePath("/buy/catalogue"); return true; },
});
