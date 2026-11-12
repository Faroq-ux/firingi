"use server";
/** FIRINGI review actions (permissions are checked again inside each service). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { adminSetStatus, recordManualVatVerification, runViesCheck, setCommissionRate } from "@/server/services/company";
import { reviewDocument } from "@/server/services/documents";
import { reviewRestrictionAccess } from "@/server/services/restrictions";
import { reviewDriver } from "@/server/services/drivers";

const done = () => { revalidatePath("/admin", "layout"); return null; };

export const setCompanyStatusAction = defineAction({
  permission: ["admin.vendors.approve", "admin.customers.approve"],
  schema: z.object({
    companyId: z.string(),
    to: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"]),
    reason: z.string().trim().max(1000).optional().nullable(),
    approveAnyway: z.boolean().optional(),
  }),
  handler: async (ctx, i) => { await adminSetStatus(ctx, i.companyId, i.to, i.reason, { approveAnyway: i.approveAnyway }); return done(); },
});

export const reviewDocumentAction = defineAction({
  permission: ["admin.vendors.approve", "admin.customers.approve", "admin.risk.manage", "admin.fleet.manage"],
  schema: z.object({
    documentId: z.string(),
    decision: z.enum(["APPROVED", "REJECTED"]),
    note: z.string().trim().max(1000).optional().nullable(),
    expiresAt: z.string().optional().nullable(),
  }),
  handler: async (ctx, i) => {
    await reviewDocument(ctx, i.documentId, i.decision, i.note, i.expiresAt ? new Date(i.expiresAt) : undefined);
    return done();
  },
});

export const runViesAction = defineAction({
  permission: ["admin.vendors.view", "admin.vendors.approve", "admin.customers.approve", "admin.risk.manage"],
  schema: z.object({ companyId: z.string() }),
  handler: async (ctx, i) => {
    const r = await runViesCheck(ctx, i.companyId);
    done();
    return { result: r.result, ref: r.consultationRef };
  },
});

export const manualVatAction = defineAction({
  permission: ["admin.risk.manage", "admin.vendors.approve", "admin.customers.approve"],
  schema: z.object({ companyId: z.string(), note: z.string().trim().min(10).max(180) }),
  handler: async (ctx, i) => { await recordManualVatVerification(ctx, i.companyId, i.note); return done(); },
});

export const setCommissionAction = defineAction({
  permission: "admin.vendors.commission",
  schema: z.object({ companyId: z.string(), rate: z.coerce.number().min(0).max(100), note: z.string().trim().max(300).optional().nullable() }),
  handler: async (ctx, i) => { await setCommissionRate(ctx, i.companyId, i.rate, i.note); return done(); },
});

export const reviewRestrictionAction = defineAction({
  permission: ["admin.customers.approve", "admin.risk.manage"],
  schema: z.object({
    id: z.string(),
    decision: z.enum(["APPROVED", "REJECTED", "REVOKED"]),
    note: z.string().trim().max(1000).optional().nullable(),
    validUntil: z.string().optional().nullable(),
  }),
  handler: async (ctx, i) => {
    await reviewRestrictionAccess(ctx, i.id, i.decision, { note: i.note, validUntil: i.validUntil ? new Date(i.validUntil) : null });
    return done();
  },
});

export const reviewDriverAction = defineAction({
  permission: "admin.fleet.manage",
  schema: z.object({ driverId: z.string(), to: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]), reason: z.string().trim().max(1000).optional().nullable() }),
  handler: async (ctx, i) => { await reviewDriver(ctx, i.driverId, i.to, i.reason); return done(); },
});
