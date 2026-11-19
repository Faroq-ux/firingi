"use server";
/** Phase 21: integrations — import & sync, feeds, API keys, webhooks, accounting mapping. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import { applyImport, cancelImport, guessMapping, parseFile, previewImport, MAX_BYTES, type Mapping as MappingT } from "@/server/integrations/catalogue-import";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { deleteProfile, runFeed, saveProfile } from "@/server/integrations/feeds";
import { createEndpoint, deleteEndpoint, sendTest, setEndpointActive } from "@/server/integrations/webhooks";
import { createOwnApiKey, revokeOwnApiKey } from "@/server/services/api-keys";
import { saveAccountMap, DEFAULT_ACCOUNTS, JOURNALS } from "@/server/integrations/accounting";
import { FIELDS } from "@/server/integrations/catalogue-import";

const Id = z.object({ id: z.string().min(1).max(40) });
const IMPORT_PERMS = ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"] as const;
const refreshImport = () => revalidatePath("/vendor/products/import", "layout");
const refreshIntegrations = () => { revalidatePath("/vendor/company/integrations"); revalidatePath("/buy/company/integrations"); };

// ── import & sync ──
export const applyImportAction = defineAction({
  permission: [...IMPORT_PERMS], schema: z.object({ runId: z.string().min(1).max(40), confirmBig: z.boolean().optional() }),
  handler: async (ctx, i) => { const r = await applyImport(ctx, i.runId, { confirmBig: i.confirmBig }); refreshImport(); return r; },
});
export const cancelImportAction = defineAction({
  permission: [...IMPORT_PERMS], schema: z.object({ runId: z.string().min(1).max(40) }),
  handler: async (ctx, i) => { await cancelImport(ctx, i.runId); refreshImport(); return true; },
});
const Mapping = z.record(z.string().max(120), z.union([z.enum(FIELDS), z.literal("")]));
export const saveProfileAction = defineAction({
  permission: [...IMPORT_PERMS],
  schema: z.object({ id: z.string().max(40).optional(), name: z.string().min(1).max(80), mapping: Mapping, feedUrl: z.string().max(1000).nullable().optional(), everyHours: z.number().int().min(1).max(168).nullable().optional(), enabled: z.boolean().optional() }),
  handler: async (ctx, i) => { const p = await saveProfile(ctx, i); refreshImport(); return { id: p.id }; },
});
export const deleteProfileAction = defineAction({ permission: [...IMPORT_PERMS], schema: Id, handler: async (ctx, i) => { await deleteProfile(ctx, i.id); refreshImport(); return true; } });
export const runFeedAction = defineAction({
  permission: [...IMPORT_PERMS], schema: Id,
  handler: async (ctx, i) => { const r = await runFeed(i.id, ctx); refreshImport(); return r; },
});

// ── API keys ──
export const createKeyAction = defineAction({
  permission: "company.integrations.manage", schema: z.object({ name: z.string().min(1).max(80), scopes: z.array(z.string().max(40)).max(10) }),
  handler: async (ctx, i) => { const k = await createOwnApiKey(ctx, i); refreshIntegrations(); return k; },
});
export const revokeKeyAction = defineAction({ permission: "company.integrations.manage", schema: Id, handler: async (ctx, i) => { await revokeOwnApiKey(ctx, i.id); refreshIntegrations(); return true; } });

// ── webhooks ──
export const createWebhookAction = defineAction({
  permission: "company.integrations.manage", schema: z.object({ url: z.string().min(8).max(1000), events: z.array(z.string().max(40)).max(10) }),
  handler: async (ctx, i) => { const r = await createEndpoint(ctx, i); refreshIntegrations(); return r; },
});
export const toggleWebhookAction = defineAction({
  permission: "company.integrations.manage", schema: z.object({ id: z.string().min(1).max(40), active: z.boolean() }),
  handler: async (ctx, i) => { await setEndpointActive(ctx, i.id, i.active); refreshIntegrations(); return true; },
});
export const deleteWebhookAction = defineAction({ permission: "company.integrations.manage", schema: Id, handler: async (ctx, i) => { await deleteEndpoint(ctx, i.id); refreshIntegrations(); return true; } });
export const testWebhookAction = defineAction({ permission: "company.integrations.manage", schema: Id, handler: async (ctx, i) => { const r = await sendTest(ctx, i.id); refreshIntegrations(); return r; } });

// ── FIRINGI: accounting mapping ──
const Acc = z.string().regex(/^\d{1,12}$/);
const Code = z.string().min(1).max(10);
export const saveAccountMapAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({
    customers: Acc, suppliers: Acc, sales: Acc, purchases: Acc, bank: Acc, cash: Acc, cardClearing: Acc, excise: z.string().max(12).regex(/^\d*$/).default(""),
    vatOutput: z.record(z.string().max(8), Acc), vatInput: z.record(z.string().max(8), Acc), perPartner: z.boolean(),
    journals: z.object({ SALES: Code, CREDIT_NOTES: Code, RECEIPTS: Code, SUPPLIER_INVOICES: Code, PAYOUTS: Code }),
    decimal: z.enum(["comma", "dot"]),
  }),
  handler: async (ctx, i) => { const v = await saveAccountMap(ctx, { ...DEFAULT_ACCOUNTS, ...i }); revalidatePath("/admin/finance/accounting-export"); return v; },
});

// ── upload (FormData) ──

async function fileOf(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) throw new ValidationError("Choose a file (Excel or CSV).");
  if (f.size > MAX_BYTES) throw new ValidationError("The file is larger than 10 MB.");
  return { name: f.name.slice(0, 200), buf: Buffer.from(await f.arrayBuffer()) };
}

/** Step 1: read the file, show its columns and a few rows, guess the mapping. */
export async function inspectImportAction(fd: FormData) {
  return runAction(async (ctx) => {
    if (!can(ctx, [...IMPORT_PERMS])) throw new ForbiddenError();
    const { name, buf } = await fileOf(fd);
    const sheet = await parseFile(buf, name);
    return { fileName: name, headers: sheet.headers, sample: sheet.rows.slice(0, 6), total: sheet.rows.length, mapping: guessMapping(sheet.headers) };
  });
}

/** Step 2: the same file + the chosen mapping → a preview run (nothing changes yet). Optionally saved as a profile / feed. */
export async function previewUploadAction(fd: FormData) {
  return runAction(async (ctx) => {
    if (!can(ctx, [...IMPORT_PERMS])) throw new ForbiddenError();
    const { name, buf } = await fileOf(fd);
    const mapping = Mapping.parse(JSON.parse(String(fd.get("mapping") ?? "{}"))) as MappingT;
    const sheet = await parseFile(buf, name);
    const saveAs = String(fd.get("saveAs") ?? "").trim();
    const profile = saveAs ? await saveProfile(ctx, { name: saveAs, mapping }) : null;
    const run = await previewImport(ctx, { sheet, mapping, source: "UPLOAD", fileName: name, profileId: profile?.id ?? null });
    refreshImport();
    return { runId: run.id };
  });
}

export const accountingPreviewAction = defineAction({
  permission: ["admin.finance.view", "admin.invoices.view"],
  schema: z.object({ from: z.string().date(), to: z.string().date(), journals: z.array(z.enum(JOURNALS)) }),
  handler: async (ctx, i) => (await import("@/server/integrations/accounting")).accountingPreview(ctx, i),
});
