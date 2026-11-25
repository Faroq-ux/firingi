"use server";
/** FIRINGI marketing catalogues: create, edit, fill (filters / AI), publish, translate, upload own PDF, send. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as M from "@/server/marketing/catalogues";
import { storeUpload } from "@/server/services/storage";
import { ValidationError } from "@/server/errors";
import { MC_LAYOUTS, MC_SCOPES } from "@/lib/marketing-catalogue";
import { UI_LOCALES } from "@/i18n/config";

const PERM = "admin.marketing.manage" as const;
const locale = z.string().refine((l) => (UI_LOCALES as readonly string[]).includes(l), "Unknown language");
const id = z.string().min(1).max(40);
const re = <T,>(v: T, cid?: string) => { revalidatePath("/admin/marketing/catalogues"); if (cid) revalidatePath(`/admin/marketing/catalogues/${cid}`); return v; };
const input = z.object({
  title: z.string().trim().min(1).max(120), subtitle: z.string().max(160).optional().nullable(), intro: z.string().max(1200).optional().nullable(),
  locale, countryId: id, scope: z.enum(MC_SCOPES), scopeIds: z.array(id).max(100),
  filters: z.object({ categoryIds: z.array(id).max(100).optional(), brandIds: z.array(id).max(100).optional(), q: z.string().max(120).optional(), bestSellers: z.boolean().optional(), withImages: z.boolean().optional(), max: z.number().int().min(1).max(200).optional() }),
  items: z.array(z.object({ offerId: id, section: z.string().max(80).optional().nullable() })).max(200),
  layout: z.enum(MC_LAYOUTS),
  options: z.object({ price: z.enum(["NONE", "NET", "GROSS"]), barcode: z.boolean(), qty: z.boolean(), supplier: z.enum(["NONE", "NAME", "AREA"]), qr: z.boolean() }),
});

export const createCatalogueAction = defineAction({ permission: PERM, schema: input, handler: async (ctx, i) => re({ id: (await M.createCatalogue(ctx, i)).id }) });
export const updateCatalogueAction = defineAction({ permission: PERM, schema: z.object({ id, data: input }), handler: async (ctx, i) => { await M.updateCatalogue(ctx, i.id, i.data); return re(true, i.id); } });
export const fillCatalogueAction = defineAction({ permission: PERM, schema: z.object({ id }), handler: async (ctx, i) => { await M.fillByFilters(ctx, i.id); return re(true, i.id); } });
export const aiCatalogueAction = defineAction({ permission: PERM, schema: z.object({ id, brief: z.string().trim().min(3).max(1000) }), handler: async (ctx, i) => { await M.aiBuild(ctx, i.id, i.brief); return re(true, i.id); } });
export const catalogueStatusAction = defineAction({ permission: PERM, schema: z.object({ id, status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]) }), handler: async (ctx, i) => { await M.setStatus(ctx, i.id, i.status); return re(true, i.id); } });
export const duplicateCatalogueAction = defineAction({ permission: PERM, schema: z.object({ id }), handler: async (ctx, i) => re({ id: (await M.duplicateCatalogue(ctx, i.id)).id }) });
export const translateCatalogueAction = defineAction({ permission: PERM, schema: z.object({ id, locale }), handler: async (ctx, i) => re({ id: (await M.translateCatalogue(ctx, i.id, i.locale)).id }) });
export const sendCatalogueAction = defineAction({ permission: PERM, schema: z.object({ id }), handler: async (ctx, i) => re(await M.campaignFor(ctx, i.id), i.id) });
export const removeCatalogueUploadAction = defineAction({ permission: PERM, schema: z.object({ id }), handler: async (ctx, i) => { await M.setUpload(ctx, i.id, null); return re(true, i.id); } });
export const saveMcSettingsAction = defineAction({ permission: PERM, schema: z.object({ enabled: z.boolean(), ai: z.boolean() }), handler: async (ctx, i) => re(await M.saveMcSettings(ctx, i)) });

/** FIRINGI's own PDF (made elsewhere, e.g. in Canva) instead of the generated one. */
export async function uploadCataloguePdfAction(fd: FormData) {
  return runAction(async (ctx) => {
    const cid = String(fd.get("id") ?? "");
    await M.getCatalogue(ctx, cid);
    const stored = await storeUpload(fd.get("file") as File, `marketing/catalogues/${cid}`);
    if (stored.mimeType !== "application/pdf") throw new ValidationError("Upload a PDF file.");
    await M.setUpload(ctx, cid, stored.key);
    return re({ key: stored.key }, cid);
  });
}
