"use server";
/** Supplier plans & early payout actions (Phase 36). Rights are checked again in the services. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as P from "@/server/plans/service";
import * as E from "@/server/plans/early-pay";
import { EARLY_PAY_MODELS, PLAN_FEATURES } from "@/lib/plans";

const id = z.string().min(1).max(64);
const done = <T>(v: T) => { revalidatePath("/vendor", "layout"); revalidatePath("/admin/vendors/plans", "layout"); return v; };
const lim = z.number().int().min(1).max(1_000_000).nullable();

// supplier
export const choosePlanAction = defineAction({ permission: null, schema: z.object({ planId: id }), handler: async (ctx, i) => done(await P.choosePlan(ctx, i.planId)) });
export const quoteEarlyPayAction = defineAction({ permission: null, schema: z.object({ ids: z.array(id).max(200) }), handler: async (ctx, i) => {
  const q = await E.quoteEarlyPay(ctx, i.ids);
  return { amount: q.amount, fee: q.fee, model: q.model, room: q.room, lines: q.lines.length };
} });
export const requestEarlyPayAction = defineAction({ permission: null, schema: z.object({ ids: z.array(id).min(1).max(200) }), handler: async (ctx, i) => { const p = await E.requestEarlyPay(ctx, i.ids); return done({ number: p.number }); } });
export const cancelEarlyPayAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => { await E.cancelEarlyPay(ctx, i.id); return done(true); } });

// FIRINGI
export const savePlansSettingsAction = defineAction({
  permission: ["admin.vendors.commission", "admin.settings.manage"],
  schema: z.object({
    enabled: z.boolean(), trialDays: z.number().int(), trialPlanCode: z.string().max(20), defaultPlanCode: z.string().max(20), billing: z.enum(["PAYOUT", "INVOICE"]), invoiceDueDays: z.number().int(),
    reminderDays: z.array(z.number().int()).max(10), earlyPay: z.object({ enabled: z.boolean(), defaultLimit: z.number(), minDaysEarly: z.number().int() }),
  }),
  handler: async (ctx, i) => done(await P.savePlansSettings(ctx, i)),
});
export const savePlanAction = defineAction({
  permission: ["admin.vendors.commission", "admin.settings.manage"],
  schema: z.object({
    id: id.nullable(), code: z.string().max(20), name: z.string().max(60), description: z.string().max(300).nullable(), monthlyPrice: z.number(), commissionPct: z.number().nullable(),
    features: z.array(z.enum(PLAN_FEATURES)), maxProducts: lim, maxUsers: lim, maxWarehouses: lim, maxDrivers: lim,
    earlyPayModel: z.enum(EARLY_PAY_MODELS), earlyPayRate: z.number(), earlyPayMinFee: z.number(), freeEarlyPays: z.number().int(), active: z.boolean(), sortOrder: z.number().int(),
  }),
  handler: async (ctx, i) => { const p = await P.savePlan(ctx, i); return done({ id: p.id }); },
});
export const adminSetPlanAction = defineAction({ permission: ["admin.vendors.commission", "admin.settings.manage"], schema: z.object({ companyId: id, planId: id, immediate: z.boolean() }), handler: async (ctx, i) => done(await P.adminSetPlan(ctx, i.companyId, i.planId, i.immediate)) });
export const extendTrialAction = defineAction({ permission: ["admin.vendors.commission", "admin.settings.manage"], schema: z.object({ companyId: id, days: z.number().int() }), handler: async (ctx, i) => { await P.extendTrial(ctx, i.companyId, i.days); return done(true); } });
export const setSubscriptionOptionsAction = defineAction({
  permission: ["admin.vendors.commission", "admin.settings.manage"],
  schema: z.object({ companyId: id, billing: z.enum(["PAYOUT", "INVOICE"]).optional(), commissionLocked: z.boolean().optional(), earlyPayEnabled: z.boolean().optional(), earlyPayLimit: z.number().nullable().optional() }),
  handler: async (ctx, i) => { const { companyId, ...rest } = i; await P.setSubscriptionOptions(ctx, companyId, rest); return done(true); },
});
export const runPlansNowAction = defineAction({ permission: ["admin.vendors.commission", "admin.settings.manage"], schema: z.object({}), handler: async () => done(await P.runPlansJob()) });
export const payEarlyPayoutAction = defineAction({ permission: "admin.finance.manage", schema: z.object({ id, reference: z.string().max(120).nullable() }), handler: async (ctx, i) => { const r = await E.payEarlyPayout(ctx, i.id, { reference: i.reference }); return done({ net: r.net.toString() }); } });
export const rejectEarlyPayoutAction = defineAction({ permission: "admin.finance.manage", schema: z.object({ id, reason: z.string().max(500) }), handler: async (ctx, i) => { await E.rejectEarlyPayout(ctx, i.id, i.reason); return done(true); } });
