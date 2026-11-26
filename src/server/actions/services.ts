"use server";
/** Services & used cooking oil (Phase 68): customers, providers and FIRINGI (the services re-check every right). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { firstIssue } from "@/server/ai/ops/parse";
import { applySchema, doneSchema, fryerSchema, id, logSchema, planSchema, settingsSchema, typeSchema } from "@/server/servicing/schema";

const plans = () => import("@/server/servicing/plans");
const cat = () => import("@/server/servicing/catalogue");
const oil = () => import("@/server/servicing/oil");
const buy = <T>(v: T) => { revalidatePath("/buy/services", "layout"); return v; };
const vend = <T>(v: T) => { revalidatePath("/vendor/services"); return v; };
const adm = <T>(v: T) => { revalidatePath("/admin/services"); return v; };
const ok = { ok: true } as const;

// ── customer ──
export const subscribeServiceAction = defineAction({
  permission: "buyer.services.manage", schema: z.object({ serviceTypeId: id, input: z.unknown() }),
  handler: async (ctx, i) => { const p = await (await plans()).subscribe(ctx, { serviceTypeId: i.serviceTypeId, ...firstIssue(planSchema, i.input) }); return buy({ id: p.id, number: p.number }); },
});
export const changeServicePlanAction = defineAction({
  permission: "buyer.services.manage", schema: z.object({ id, input: z.unknown() }),
  handler: async (ctx, i) => { await (await plans()).changePlan(ctx, i.id, firstIssue(planSchema, i.input)); return buy(ok); },
});
export const setServicePlanStatusAction = defineAction({
  permission: "buyer.services.manage", schema: z.object({ id, status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]), pausedUntil: z.coerce.date().nullable().optional() }),
  handler: async (ctx, i) => { await (await plans()).setPlanStatus(ctx, i.id, i.status, i.pausedUntil ?? null); return buy(ok); },
});
export const requestServiceAction = defineAction({
  permission: ["buyer.services.log", "buyer.services.manage"], schema: z.object({ serviceTypeId: id, date: z.coerce.date().nullable().optional(), note: z.string().trim().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const v = await (await plans()).requestVisit(ctx, { serviceTypeId: i.serviceTypeId, date: i.date ?? null, note: i.note ?? null, reason: "CUSTOMER" }); return buy({ id: v.id, number: v.number }); },
});
export const skipServiceVisitAction = defineAction({ permission: "buyer.services.manage", schema: z.object({ id }), handler: async (ctx, i) => { await (await plans()).skipVisit(ctx, i.id); return buy(ok); } });
export const moveServiceVisitAction = defineAction({
  permission: ["buyer.services.log", "buyer.services.manage", "vendor.services.manage", "vendor.services.visit", "admin.services.manage"], schema: z.object({ id, date: z.coerce.date() }),
  handler: async (ctx, i) => { await (await plans()).moveVisit(ctx, i.id, i.date); revalidatePath("/vendor/services"); return buy(ok); },
});

// ── fryers & oil ──
export const saveFryerAction = defineAction({
  permission: "buyer.services.manage", schema: z.object({ id: id.nullable(), input: z.unknown() }),
  handler: async (ctx, i) => { const f = await (await oil()).saveFryer(ctx, i.id, firstIssue(fryerSchema, i.input)); return buy({ id: f.id }); },
});
export const logFryerAction = defineAction({
  permission: ["buyer.services.log", "buyer.services.manage"], schema: z.object({ fryerId: id, input: z.unknown() }),
  handler: async (ctx, i) => { await (await oil()).logFryer(ctx, i.fryerId, firstIssue(logSchema, i.input)); return buy(ok); },
});
export const deleteFryerLogAction = defineAction({ permission: ["buyer.services.log", "buyer.services.manage"], schema: z.object({ id }), handler: async (ctx, i) => { await (await oil()).deleteLog(ctx, i.id); return buy(ok); } });

// ── provider ──
export const applyProviderAction = defineAction({
  permission: "vendor.services.manage", schema: z.unknown(),
  handler: async (ctx, i) => { const p = await (await cat()).applyProvider(ctx, firstIssue(applySchema, i)); return vend({ id: p.id }); },
});
export const confirmServiceVisitAction = defineAction({
  permission: ["vendor.services.manage", "vendor.services.visit", "admin.services.manage"], schema: z.object({ id, date: z.coerce.date().nullable().optional() }),
  handler: async (ctx, i) => { await (await plans()).confirmVisit(ctx, i.id, i.date ?? null); revalidatePath("/admin/services"); return vend(ok); },
});
export const completeServiceVisitAction = defineAction({
  permission: ["vendor.services.manage", "vendor.services.visit", "admin.services.manage"], schema: z.object({ id, input: z.unknown() }),
  handler: async (ctx, i) => { const v = await (await plans()).completeVisit(ctx, i.id, firstIssue(doneSchema, i.input)); revalidatePath("/admin/services"); return vend({ id: v.id }); },
});
export const missServiceVisitAction = defineAction({
  permission: ["vendor.services.manage", "vendor.services.visit", "admin.services.manage"], schema: z.object({ id, reason: z.string().trim().min(2, "Say why it couldn't be done.").max(300) }),
  handler: async (ctx, i) => { await (await plans()).missVisit(ctx, i.id, i.reason); revalidatePath("/admin/services"); return vend(ok); },
});

// ── FIRINGI ──
export const saveServiceTypeAction = defineAction({
  permission: "admin.services.manage", schema: z.object({ id: id.nullable(), input: z.unknown() }),
  handler: async (ctx, i) => { const t = await (await cat()).saveType(ctx, i.id, firstIssue(typeSchema, i.input)); return adm({ id: t.id }); },
});
export const decideProviderAction = defineAction({
  permission: "admin.services.manage",
  schema: z.object({ id, approve: z.boolean(), suspend: z.boolean().optional(), note: z.string().trim().max(500).nullable().optional(), invoicedBy: z.enum(["FIRINGI", "PROVIDER", ""]).nullable().optional(), commissionPct: z.coerce.number().min(0).max(100).nullable().optional() }),
  handler: async (ctx, i) => { await (await cat()).decideProvider(ctx, i.id, { approve: i.approve, note: i.note ?? null, invoicedBy: i.invoicedBy === undefined ? undefined : i.invoicedBy || null, commissionPct: i.commissionPct, status: i.suspend ? "SUSPENDED" : undefined }); return adm(ok); },
});
export const addFiringiProviderAction = defineAction({
  permission: "admin.services.manage", schema: z.object({ serviceTypeId: id, countries: z.array(z.string().trim().length(2)).max(40) }),
  handler: async (ctx, i) => { await (await cat()).addFiringiProvider(ctx, i.serviceTypeId, i.countries); return adm(ok); },
});
export const reassignServicePlanAction = defineAction({ permission: "admin.services.manage", schema: z.object({ planId: id, providerId: id }), handler: async (ctx, i) => { await (await plans()).reassignPlan(ctx, i.planId, i.providerId); return adm(ok); } });
export const markServicePaidAction = defineAction({
  permission: ["admin.services.manage"], schema: z.object({ ids: z.array(id).min(1).max(500), what: z.enum(["BUYBACK", "PROVIDER"]) }),
  handler: async (ctx, i) => adm({ count: await (await plans()).markPaid(ctx, i.ids, i.what) }),
});
export const invoiceServiceCommissionsAction = defineAction({
  permission: ["admin.services.manage"], schema: z.object({}),
  handler: async (ctx) => {
    const { can } = await import("@/server/rbac/guard");
    if (!can(ctx, "admin.finance.manage")) throw new (await import("@/server/errors")).ForbiddenError("Invoicing needs the Finance right.");
    const { invoicePrintCommissions } = await import("@/server/servicing/printing");
    return adm({ invoices: (await (await plans()).invoiceCommissions(ctx.user.id, new Date())) + (await invoicePrintCommissions(ctx.user.id, new Date())) });
  },
});
export const saveServicesSettingsAction = defineAction({
  permission: ["admin.services.manage", "admin.settings.manage"], schema: settingsSchema,
  handler: async (ctx, i) => { await (await import("@/server/servicing/settings")).saveServicesSettings(ctx, i); return adm(ok); },
});
export const setCompanyServicesAction = defineAction({
  permission: ["admin.services.manage", "admin.settings.manage"], schema: z.object({ companyId: id, value: z.enum(["ON", "OFF"]).nullable() }),
  handler: async (ctx, i) => { await (await import("@/server/servicing/settings")).setCompanyServices(ctx, i.companyId, i.value); return adm(ok); },
});
