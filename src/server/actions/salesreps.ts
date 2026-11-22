"use server";
/** Sales reps (Phase 62). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as R from "@/server/salesreps/service";

const id = z.string().min(1).max(64);
function refresh() {
  revalidatePath("/vendor/reps", "layout");
  revalidatePath("/buy/orders/rep-orders");
  revalidatePath("/admin/vendors/sales-reps");
}

export const saveRepAction = defineAction({
  permission: "vendor.reps.manage",
  schema: z.object({ userId: id, commissionPct: z.number().min(0).max(50), monthlyTarget: z.number().min(0).max(100_000_000).nullable().optional(), active: z.boolean().optional() }),
  handler: async (ctx, i) => { const r = await R.saveRep(ctx, i); refresh(); return r; },
});

export const assignCustomerAction = defineAction({
  permission: "vendor.reps.manage",
  schema: z.object({ buyerCompanyId: id, repId: id.nullable() }),
  handler: async (ctx, i) => { await R.assignCustomer(ctx, i.buyerCompanyId, i.repId); refresh(); return true; },
});

export const planVisitAction = defineAction({
  permission: ["vendor.reps.manage", "vendor.reps.field"],
  schema: z.object({ buyerCompanyId: id, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), repId: id.nullable().optional(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await R.planVisit(ctx, i); refresh(); return r; },
});

export const checkInAction = defineAction({
  permission: "vendor.reps.field",
  schema: z.object({ buyerCompanyId: id, latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional() }),
  handler: async (ctx, i) => { const r = await R.checkIn(ctx, i); refresh(); return r; },
});

export const finishVisitAction = defineAction({
  permission: "vendor.reps.field",
  schema: z.object({ id, outcome: z.enum(["ORDER", "NO_ORDER", "FOLLOW_UP", "CLOSED"]), note: z.string().max(1000).nullable().optional() }),
  handler: async (ctx, i) => { await R.finishVisit(ctx, i.id, i); refresh(); return true; },
});

export const cancelVisitAction = defineAction({
  permission: "vendor.reps.field", schema: z.object({ id }),
  handler: async (ctx, i) => { await R.cancelVisit(ctx, i.id); refresh(); return true; },
});

/** A visit photo (multipart: id, file). */
export async function addVisitPhotoAction(fd: FormData) {
  return runAction(async (ctx) => {
    const visitId = id.parse(String(fd.get("id") ?? ""));
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new (await import("@/server/errors")).ValidationError("Please choose a picture.");
    await R.addVisitPhoto(ctx, visitId, f);
    refresh();
    return true;
  });
}

export const takeOrderAction = defineAction({
  permission: "vendor.reps.field",
  schema: z.object({
    buyerCompanyId: id, addressId: id, note: z.string().max(500).nullable().optional(), visitId: id.nullable().optional(),
    items: z.array(z.object({ offerId: id, qty: z.number().int().min(1).max(100_000) })).min(1).max(100),
  }),
  handler: async (ctx, i) => { const r = await R.takeOrder(ctx, i); refresh(); return r; },
});

export const repProductsAction = defineAction({
  permission: "vendor.reps.field",
  schema: z.object({ buyerCompanyId: id, q: z.string().max(80).optional() }),
  handler: async (ctx, i) => R.productsForCustomer(ctx, i.buyerCompanyId, i.q),
});

export const cancelRepOrderAction = defineAction({
  permission: "vendor.reps.field", schema: z.object({ id }),
  handler: async (ctx, i) => { await R.cancelRepOrder(ctx, i.id); refresh(); return true; },
});

export const decideRepOrderAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ id, accept: z.boolean() }),
  handler: async (ctx, i) => { const r = await R.decideRepOrder(ctx, i.id, i.accept); refresh(); revalidatePath("/buy/orders/history"); return r; },
});

export const setAutoConfirmAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ vendorCompanyId: id, on: z.boolean() }),
  handler: async (ctx, i) => { await R.setAutoConfirm(ctx, i.vendorCompanyId, i.on); refresh(); return true; },
});

export const saveSalesRepSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ enabled: z.boolean(), allowAutoConfirm: z.boolean(), confirmHours: z.number().int().min(1).max(168), maxPhotos: z.number().int().min(0).max(10) }),
  handler: async (ctx, i) => { await R.saveSalesRepSettings(ctx, i); refresh(); return true; },
});
