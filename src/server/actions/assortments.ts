"use server";
/** Customer assortments (Phase 64). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as A from "@/server/assortments/service";

const id = z.string().min(1).max(64);
const input = z.object({
  name: z.string().min(1).max(120), mode: z.enum(["ONLY_LISTED", "HIDE_LISTED", "MUST_STOCK"]), target: z.enum(["ALL", "GROUP", "CUSTOMER"]),
  targetGroupId: id.nullable().optional(), targetCompanyId: id.nullable().optional(), active: z.boolean().optional(), note: z.string().max(500).nullable().optional(),
});
function refresh() {
  revalidatePath("/vendor/products/assortments", "layout");
  revalidatePath("/buy/orders/must-stock");
  revalidatePath("/admin/vendors/assortments");
}

export const createAssortmentAction = defineAction({
  permission: "vendor.pricing.manage", schema: input,
  handler: async (ctx, i) => { const a = await A.createAssortment(ctx, i); refresh(); return { id: a.id }; },
});
export const updateAssortmentAction = defineAction({
  permission: "vendor.pricing.manage", schema: input.extend({ id }),
  handler: async (ctx, i) => { await A.updateAssortment(ctx, i.id, i); refresh(); return true; },
});
export const deleteAssortmentAction = defineAction({
  permission: "vendor.pricing.manage", schema: z.object({ id }),
  handler: async (ctx, i) => { await A.deleteAssortment(ctx, i.id); refresh(); return true; },
});
export const searchOwnProductsAction = defineAction({
  permission: "vendor.pricing.manage", schema: z.object({ id, q: z.string().max(60) }),
  handler: async (ctx, i) => A.searchOwnProducts(ctx, i.id, i.q),
});
export const addAssortmentItemsAction = defineAction({
  permission: "vendor.pricing.manage", schema: z.object({ id, offerIds: z.array(id).max(5000).optional(), skus: z.string().max(100_000).nullable().optional(), mustStock: z.boolean().optional() }),
  handler: async (ctx, i) => { const r = await A.addItems(ctx, i.id, i); refresh(); return r; },
});
export const removeAssortmentItemAction = defineAction({
  permission: "vendor.pricing.manage", schema: z.object({ id, offerId: id }),
  handler: async (ctx, i) => { await A.removeItem(ctx, i.id, i.offerId); refresh(); return true; },
});
export const setMustStockAction = defineAction({
  permission: "vendor.pricing.manage", schema: z.object({ id, offerId: id, on: z.boolean() }),
  handler: async (ctx, i) => { await A.setMustStock(ctx, i.id, i.offerId, i.on); refresh(); return true; },
});
export const assortmentTargetsAction = defineAction({
  permission: ["vendor.pricing.manage", "vendor.products.view"], schema: z.object({ q: z.string().max(60).nullable().optional() }),
  handler: async (ctx, i) => A.targetOptions(ctx, i.q),
});
export const previewAssortmentAction = defineAction({
  permission: ["vendor.pricing.manage", "vendor.products.view"], schema: z.object({ buyerCompanyId: id }),
  handler: async (ctx, i) => A.previewForCustomer(ctx, i.buyerCompanyId),
});

export const addGapsToCartAction = defineAction({
  permission: "buyer.orders.place", schema: z.object({ vendorId: id.nullable().optional() }),
  handler: async (ctx, i) => { const r = await A.addGapsToCart(ctx, i.vendorId); revalidatePath("/buy/cart"); return r; },
});

export const saveAssortmentSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ enabled: z.boolean(), modes: z.object({ ONLY_LISTED: z.boolean(), HIDE_LISTED: z.boolean(), MUST_STOCK: z.boolean() }), gapDays: z.number().int().min(7).max(365), reminders: z.boolean() }),
  handler: async (ctx, i) => { const r = await A.saveAssortmentSettings(ctx, i); refresh(); return r; },
});
export const setVendorAssortmentsAction = defineAction({
  permission: "admin.settings.manage", schema: z.object({ vendorId: id, on: z.boolean() }),
  handler: async (ctx, i) => { await A.setVendorAssortments(ctx, i.vendorId, i.on); refresh(); return true; },
});
export const searchAssortmentVendorsAction = defineAction({
  permission: "admin.settings.manage", schema: z.object({ q: z.string().max(60) }),
  handler: async (ctx, i) => A.searchVendors(ctx, i.q),
});
