"use server";
/** Price intelligence actions (Phase 29). Permissions are checked again inside the services. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as svc from "@/server/price-intel/service";
import { applyCommissionSuggestion } from "@/server/price-intel/insights";

const adminDone = () => { revalidatePath("/admin/pricing/intelligence", "layout"); return null; };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal(""));

export const approvePriceChangeAction = defineAction({
  permission: "admin.pricing.manage",
  schema: z.object({ id: z.string(), effectiveAt: day, note: z.string().trim().max(500).optional().nullable() }),
  handler: async (ctx, i) => { const r = await svc.approveRequest(ctx, i.id, { effectiveAt: i.effectiveAt || null, note: i.note }); adminDone(); return { effectiveAt: r.effectiveAt.toISOString(), customersTold: r.customersTold }; },
});

export const rejectPriceChangeAction = defineAction({
  permission: "admin.pricing.manage",
  schema: z.object({ id: z.string(), note: z.string().trim().min(1).max(500) }),
  handler: async (ctx, i) => { await svc.rejectRequest(ctx, i.id, i.note); return adminDone(); },
});

export const cancelPriceChangeAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ id: z.string() }),
  handler: async (ctx, i) => { await svc.cancelRequest(ctx, i.id); revalidatePath("/vendor/products", "layout"); return null; },
});

export const handlePriceAlertAction = defineAction({
  permission: "admin.pricing.manage",
  schema: z.object({ id: z.string(), to: z.enum(["ACKNOWLEDGED", "DISMISSED"]), note: z.string().trim().max(300).optional().nullable() }),
  handler: async (ctx, i) => { await svc.handleAlert(ctx, i.id, i.to, i.note); return adminDone(); },
});

export const askSupplierReviewAction = defineAction({
  permission: "admin.pricing.manage",
  schema: z.object({ offerId: z.string(), message: z.string().trim().max(300).optional().nullable() }),
  handler: async (ctx, i) => { const r = await svc.askSupplierToReview(ctx, i.offerId, i.message); adminDone(); return r; },
});

export const applyCommissionSuggestionAction = defineAction({
  permission: "admin.vendors.commission",
  schema: z.object({ vendorId: z.string(), rate: z.number().min(0).max(100) }),
  handler: async (ctx, i) => { await applyCommissionSuggestion(ctx, i.vendorId, i.rate); return adminDone(); },
});

export const savePriceSettingsAction = defineAction({
  permission: "admin.pricing.manage",
  schema: z.object({
    approvalThresholdPct: z.number(), noticeDays: z.number().int(), jumpPct: z.number(), jumpWindowDays: z.number().int(), outlierPct: z.number(), minSuppliers: z.number().int(), notifyBuyersDays: z.number().int(),
  }),
  handler: async (ctx, i) => { await svc.savePriceSettings(ctx, i); return adminDone(); },
});

export const runPricingCheckAction = defineAction({
  permission: "admin.pricing.manage",
  schema: z.object({}),
  handler: async (ctx) => { svc.requireManage(ctx); const r = await svc.runPricingJob(); adminDone(); return r; },
});
