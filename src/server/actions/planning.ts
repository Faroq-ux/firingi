"use server";
/** Demand planning actions (Phase 30). Permissions are checked again inside the services. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as svc from "@/server/planning/service";

const vendorDone = () => { revalidatePath("/vendor/inventory/planning", "layout"); return null; };
const adminDone = () => { revalidatePath("/admin/inventory/planning", "layout"); return null; };
const id = z.string().min(1).max(64);
const int = (lo: number, hi: number) => z.number().int().min(lo).max(hi);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const orderSuggestionsAction = defineAction({
  permission: "vendor.purchasing.manage",
  schema: z.object({ picks: z.array(z.object({ id, qty: int(1, 1_000_000), supplierId: id.nullable().optional(), sellerCompanyId: id.nullable().optional(), sourceOfferId: id.nullable().optional(), unitCost: z.number().min(0).max(1e7).nullable().optional() })).min(1).max(200) }),
  handler: async (ctx, i) => { const r = await svc.orderSuggestions(ctx, i.picks); vendorDone(); revalidatePath("/vendor/inventory/purchase-orders"); return r; },
});

export const dismissSuggestionAction = defineAction({
  permission: ["vendor.purchasing.manage", "vendor.inventory.manage"],
  schema: z.object({ id, snoozeDays: int(1, 90), reason: z.string().trim().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await svc.dismissSuggestion(ctx, i.id, i); return vendorDone(); },
});

export const recalculatePlanningAction = defineAction({
  permission: ["vendor.purchasing.manage", "vendor.inventory.manage"],
  schema: z.object({}),
  handler: async (ctx) => { const r = await svc.recalculate(ctx); vendorDone(); return { created: r.created, updated: r.updated, expired: r.expired }; },
});

export const savePlanningItemAction = defineAction({
  permission: "vendor.inventory.manage",
  schema: z.object({
    offerId: id, addressId: id, serviceLevel: int(50, 99).nullable().optional(), leadTimeDays: int(0, 180).nullable().optional(), minOrderQty: int(1, 100000), packMultiple: int(1, 10000),
    supplierId: id.nullable().optional(), sellerCompanyId: id.nullable().optional(), sourceOfferId: id.nullable().optional(), unitCost: z.number().min(0).max(1e7).nullable().optional(),
    excluded: z.boolean(), note: z.string().trim().max(300).nullable().optional(),
  }),
  handler: async (ctx, i) => { await svc.saveItem(ctx, i); return vendorDone(); },
});

export const savePlanningSettingsAction = defineAction({
  permission: "vendor.inventory.manage",
  schema: z.object({ serviceLevel: int(50, 99).nullable(), reviewDays: int(1, 60).nullable(), overstockDays: int(14, 365).nullable() }),
  handler: async (ctx, i) => { await svc.saveCompanySettings(ctx, i); return vendorDone(); },
});

export const setUseMeasuredAction = defineAction({
  permission: "vendor.purchasing.manage",
  schema: z.object({ supplierId: id, on: z.boolean() }),
  handler: async (ctx, i) => { await svc.setUseMeasured(ctx, i.supplierId, i.on); return vendorDone(); },
});

const eventSchema = z.object({
  id: id.nullable().optional(), name: z.string().trim().min(1).max(80), startsOn: day, endsOn: day, upliftPct: int(-90, 300),
  countryId: id.nullable().optional(), categoryIds: z.array(id).max(50).optional(), offerIds: z.array(id).max(200).optional(), isActive: z.boolean().optional(),
});
export const saveMyEventAction = defineAction({ permission: "vendor.inventory.manage", schema: eventSchema, handler: async (ctx, i) => { await svc.saveMyEvent(ctx, i); return vendorDone(); } });
export const saveGlobalEventAction = defineAction({ permission: "admin.inventory.manage", schema: eventSchema, handler: async (ctx, i) => { await svc.saveGlobalEvent(ctx, i); return adminDone(); } });
export const setEventActiveAction = defineAction({
  permission: ["vendor.inventory.manage", "admin.inventory.manage"],
  schema: z.object({ id, active: z.boolean() }),
  handler: async (ctx, i) => { await svc.setEventActive(ctx, i.id, i.active); vendorDone(); return adminDone(); },
});

export const dismissRiskAction = defineAction({
  permission: "vendor.inventory.manage",
  schema: z.object({ key: z.string().max(200), days: int(1, 90), reason: z.string().trim().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await svc.dismissRisk(ctx, i.key, i.days, i.reason); return vendorDone(); },
});

export const transferForRiskAction = defineAction({
  permission: "vendor.inventory.manage",
  schema: z.object({ offerId: id, fromAddressId: id, toAddressId: id, qty: int(1, 1_000_000), kind: z.enum(["EXPIRY", "OVERSTOCK"]) }),
  handler: async (ctx, i) => { const t = await svc.transferForRisk(ctx, i); vendorDone(); revalidatePath("/vendor/inventory/transfers"); return { id: t.id, number: t.number }; },
});

export const flagSupplierAction = defineAction({
  permission: "admin.inventory.manage",
  schema: z.object({ id, message: z.string().trim().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await svc.flagSupplier(ctx, i.id, i.message); return adminDone(); },
});

export const savePlanningDefaultsAction = defineAction({
  permission: "admin.inventory.manage",
  schema: z.object({ serviceLevel: int(50, 99), reviewDays: int(1, 60), overstockDays: int(14, 365), leadTimeDays: int(0, 60), historyWeeks: int(8, 104), horizonWeeks: int(4, 26), notify: z.boolean() }),
  handler: async (ctx, i) => { await svc.savePlanningDefaults(ctx, i); return adminDone(); },
});

export const runPlanningNowAction = defineAction({
  permission: "admin.inventory.manage",
  schema: z.object({}),
  handler: async (ctx) => { svc.requireAdminManage(ctx); const r = await svc.runPlanning(); adminDone(); return r; },
});
