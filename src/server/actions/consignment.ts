"use server";
/** Consignment stock (Phase 65). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as C from "@/server/consignment/service";

const id = z.string().min(1).max(64);
const qtys = z.record(z.string().min(1).max(64), z.number().int().min(0).max(1_000_000));
const counter = z.enum(["CUSTOMER", "SUPPLIER", "EITHER"]);
const MANAGE = "vendor.consignment.manage" as const;
const BUYER = "buyer.orders.place" as const;
function refresh() {
  revalidatePath("/vendor/consignment", "layout");
  revalidatePath("/buy/orders/consignment");
  revalidatePath("/admin/vendors/consignment");
}

// supplier
export const consignmentCustomersAction = defineAction({
  permission: MANAGE, schema: z.object({ q: z.string().max(60).nullable().optional() }),
  handler: async (ctx, i) => C.consignmentCustomers(ctx, i.q),
});
export const createSiteAction = defineAction({
  permission: MANAGE,
  schema: z.object({ buyerCompanyId: id, addressId: id, warehouseId: id, countEveryDays: z.number().int().min(1).max(90).nullable().optional(), counter: counter.optional(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const s = await C.createSite(ctx, i); refresh(); return { id: s.id, status: s.status }; },
});
export const updateSiteAction = defineAction({
  permission: MANAGE, schema: z.object({ id, countEveryDays: z.number().int().min(1).max(90), counter, note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { await C.updateSite(ctx, i.id, i); refresh(); return true; },
});
export const shippableAction = defineAction({
  permission: MANAGE, schema: z.object({ id, q: z.string().max(60).nullable().optional() }),
  handler: async (ctx, i) => C.shippableProducts(ctx, i.id, i.q),
});
export const sendStockAction = defineAction({
  permission: MANAGE, schema: z.object({ id, items: z.array(z.object({ offerId: id, qty: z.number().int().min(1).max(1_000_000) })).min(1).max(200), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const s = await C.sendStock(ctx, i.id, i.items, i.note); refresh(); return { number: s.number }; },
});
export const pickUpAction = defineAction({
  permission: MANAGE, schema: z.object({ id, back: qtys }),
  handler: async (ctx, i) => { const r = await C.pickUp(ctx, i.id, i.back); refresh(); return r; },
});
export const closeSiteAction = defineAction({
  permission: MANAGE, schema: z.object({ id }),
  handler: async (ctx, i) => { await C.closeSite(ctx, i.id); refresh(); return true; },
});
export const retryCountAction = defineAction({
  permission: [MANAGE, "admin.orders.manage", "admin.vendors.approve"], schema: z.object({ id }),
  handler: async (ctx, i) => { const r = await C.retryCount(ctx, i.id); refresh(); return r; },
});

// both sides
export const receiveShipmentAction = defineAction({
  permission: [MANAGE, BUYER], schema: z.object({ id, received: qtys }),
  handler: async (ctx, i) => { const r = await C.receiveShipment(ctx, i.id, i.received); refresh(); return r; },
});
export const submitCountAction = defineAction({
  permission: [MANAGE, "vendor.consignment.count", BUYER], schema: z.object({ id, counted: qtys, note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await C.submitCount(ctx, i.id, i.counted, i.note); refresh(); return r; },
});
export const decideCountAction = defineAction({
  permission: [MANAGE, BUYER], schema: z.object({ id, accept: z.boolean(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await C.decideCount(ctx, i.id, i.accept, i.note); refresh(); return r; },
});

// FIRINGI
export const saveConsignmentSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), channels: z.object({ DISTRIBUTOR_WHOLESALER: z.boolean(), WHOLESALER_CUSTOMER: z.boolean() }), requireApproval: z.boolean(), allowCustomerCount: z.boolean(),
    autoConfirmDays: z.number().int().min(1).max(30), expiryAlertDays: z.number().int().min(1).max(90), defaultCountEveryDays: z.number().int().min(1).max(90),
  }),
  handler: async (ctx, i) => { const r = await C.saveConsignmentSettings(ctx, i); refresh(); return r; },
});
export const setVendorConsignmentAction = defineAction({
  permission: "admin.settings.manage", schema: z.object({ vendorId: id, on: z.boolean() }),
  handler: async (ctx, i) => { await C.setVendorConsignment(ctx, i.vendorId, i.on); refresh(); return true; },
});
export const searchConsignmentVendorsAction = defineAction({
  permission: "admin.settings.manage", schema: z.object({ q: z.string().max(60) }),
  handler: async (ctx, i) => C.searchVendors(ctx, i.q),
});
export const decideSiteAction = defineAction({
  permission: ["admin.vendors.approve", "admin.settings.manage"], schema: z.object({ id, approve: z.boolean(), reason: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await C.decideSite(ctx, i.id, i.approve, i.reason); refresh(); return r; },
});
