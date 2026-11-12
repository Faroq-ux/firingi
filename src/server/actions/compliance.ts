"use server";
/** Supplier compliance actions (Phase 28). Permissions are checked again inside the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as svc from "@/server/compliance/service";

const ADMIN = ["admin.vendors.approve", "admin.risk.manage"] as const;
const adminDone = () => { revalidatePath("/admin/vendors/compliance", "layout"); return null; };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal(""));

/** Supplier uploads a certificate (multipart). */
export async function uploadCertificateAction(fd: FormData) {
  return runAction(async (ctx) => {
    const s = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : null);
    const id = await svc.uploadCertificate(ctx, { typeId: s("typeId") ?? "", number: s("number"), issuer: s("issuer"), issuedOn: s("issuedOn") || null, expiresOn: s("expiresOn") || null, file: fd.get("file") as File });
    revalidatePath("/vendor/company/compliance");
    return { id };
  });
}

export const withdrawCertificateAction = defineAction({
  permission: "company.documents.manage",
  schema: z.object({ id: z.string() }),
  handler: async (ctx, i) => { await svc.withdrawCertificate(ctx, i.id); revalidatePath("/vendor/company/compliance"); return null; },
});

export const approveCertificateAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ id: z.string(), expiresOn: day, number: z.string().trim().max(80).optional().nullable(), recheckDueOn: day, note: z.string().trim().max(500).optional().nullable() }),
  handler: async (ctx, i) => { await svc.approveCertificate(ctx, i.id, { expiresOn: i.expiresOn === undefined ? undefined : i.expiresOn || null, number: i.number, recheckDueOn: i.recheckDueOn || null, note: i.note }); return adminDone(); },
});

export const rejectCertificateAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ id: z.string(), note: z.string().trim().min(1).max(1000) }),
  handler: async (ctx, i) => { await svc.rejectCertificate(ctx, i.id, i.note); return adminDone(); },
});

export const revokeCertificateAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ id: z.string(), note: z.string().trim().min(1).max(1000) }),
  handler: async (ctx, i) => { await svc.revokeCertificate(ctx, i.id, i.note); return adminDone(); },
});

export const setBadgeHiddenAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ id: z.string(), hidden: z.boolean() }),
  handler: async (ctx, i) => { await svc.setBadgeHidden(ctx, i.id, i.hidden); return adminDone(); },
});

export const markRecheckedAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ id: z.string(), note: z.string().trim().max(500).optional().nullable() }),
  handler: async (ctx, i) => { await svc.markRechecked(ctx, i.id, i.note); return adminDone(); },
});

export const grantWaiverAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ companyId: z.string(), typeId: z.string(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(500) }),
  handler: async (ctx, i) => { await svc.grantWaiver(ctx, i.companyId, i.typeId, i.until, i.reason); return adminDone(); },
});

export const revokeWaiverAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ id: z.string() }),
  handler: async (ctx, i) => { await svc.revokeWaiver(ctx, i.id); return adminDone(); },
});

const typeSchema = z.object({
  id: z.string().nullable(),
  name: z.string().trim().max(80), description: z.string().trim().max(400).optional().nullable(),
  appliesTo: z.array(z.enum(["DISTRIBUTOR", "WHOLESALER"])), countryIds: z.array(z.string()).max(40), categoryIds: z.array(z.string()).max(50),
  required: z.boolean(), needsNumber: z.boolean(), hasExpiry: z.boolean(), recheckMonths: z.number().int().nullable(), graceDays: z.number().int(),
  badgeEnabled: z.boolean(), publicDownload: z.boolean(), isActive: z.boolean(),
});

export const saveCertificateTypeAction = defineAction({
  permission: [...ADMIN],
  schema: typeSchema,
  handler: async (ctx, { id, ...i }) => { const r = await svc.saveType(ctx, id, i); adminDone(); return r; },
});

export const setTypeBadgeAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ id: z.string(), enabled: z.boolean() }),
  handler: async (ctx, i) => { await svc.setTypeBadge(ctx, i.id, i.enabled); revalidatePath("/", "layout"); return null; },
});

export const runComplianceCheckAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({}),
  handler: async (ctx) => { if (!svc.canManageCompliance(ctx)) throw new Error("forbidden"); const r = await svc.recomputeAll(); adminDone(); return r; },
});
