"use server";
/** Phase 14 actions: costs, margin rules, KPI targets, ratings. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { deleteCost, saveCost } from "@/server/services/profit";
import { moderateRating, rateOrder, removeMarginRule, replyRating, saveMarginRule, setKpiTarget, KPI_METRICS } from "@/server/services/performance";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));
const CATS = ["DRIVERS", "FLEET", "WAREHOUSE", "STAFF", "MARKETING", "IT", "PAYMENT_FEES", "OTHER"] as const;

export const saveCostAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({
    id: z.string().nullable().optional(), date: day, endDate: day.nullable().optional(), monthly: z.boolean().optional(), category: z.enum(CATS),
    description: z.string().trim().min(1).max(200), amountNet: z.coerce.number().positive(), vatAmount: z.coerce.number().min(0).optional(), countryCode: z.string().length(2).nullable().optional(), paid: z.boolean().optional(),
  }),
  handler: async (ctx, { id, ...i }) => { const c = await saveCost(ctx, id ?? null, i); revalidatePath("/admin/finance", "layout"); return c.id; },
});
export const deleteCostAction = defineAction({ permission: "admin.finance.manage", schema: z.object({ id: z.string().min(1) }), handler: async (ctx, i) => { await deleteCost(ctx, i.id); revalidatePath("/admin/finance", "layout"); return i.id; } });

export const saveMarginRuleAction = defineAction({
  permission: "admin.pricing.manage",
  schema: z.object({
    scope: z.enum(["GLOBAL", "COUNTRY", "CATEGORY", "VENDOR"]), countryId: z.string().nullable().optional(), categoryId: z.string().nullable().optional(), vendorCompanyId: z.string().nullable().optional(),
    minMarginPercent: z.coerce.number(), targetMarginPercent: z.coerce.number().nullable().optional(), note: z.string().max(300).nullable().optional(),
  }),
  handler: async (ctx, i) => { const r = await saveMarginRule(ctx, i); revalidatePath("/admin/pricing", "layout"); return r.id; },
});
export const removeMarginRuleAction = defineAction({ permission: "admin.pricing.manage", schema: z.object({ id: z.string().min(1) }), handler: async (ctx, i) => { await removeMarginRule(ctx, i.id); revalidatePath("/admin/pricing", "layout"); return i.id; } });

export const setKpiTargetAction = defineAction({
  permission: ["admin.finance.manage", "admin.settings.manage"],
  schema: z.object({ month: day, metric: z.enum(KPI_METRICS.map((m) => m.key) as [string, ...string[]]), target: z.coerce.number().nullable() }),
  handler: async (ctx, i) => { await setKpiTarget(ctx, i.month, i.metric as never, i.target); revalidatePath("/admin/dashboard/kpi"); return i.metric; },
});

export const moderateRatingAction = defineAction({
  permission: ["admin.vendors.approve", "admin.customers.manage"],
  schema: z.object({ id: z.string().min(1), hidden: z.boolean() }),
  handler: async (ctx, i) => { await moderateRating(ctx, i.id, i.hidden); revalidatePath("/admin/vendors/management/ratings"); return i.id; },
});

/** Customer rates a delivered order (no revalidation: the form shows the result). */
export const rateOrderAction = defineAction({
  permission: ["buyer.orders.view", "buyer.orders.place"],
  schema: z.object({ orderId: z.string().min(1), stars: z.coerce.number().int().min(1).max(5), deliveryStars: z.coerce.number().int().min(1).max(5).nullable().optional(), comment: z.string().max(1000).nullable().optional() }),
  handler: async (ctx, i) => (await rateOrder(ctx, i.orderId, i)).id,
});
export const replyRatingAction = defineAction({
  permission: ["vendor.orders.manage", "vendor.orders.view"],
  schema: z.object({ id: z.string().min(1), reply: z.string().trim().min(1).max(1000) }),
  handler: async (ctx, i) => { await replyRating(ctx, i.id, i.reply); revalidatePath("/vendor/orders", "layout"); revalidatePath("/vendor/reports", "layout"); return i.id; },
});
