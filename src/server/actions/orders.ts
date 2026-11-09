"use server";
/** Cart, checkout and order actions (services re-check every permission). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as cart from "@/server/services/cart";
import * as orders from "@/server/services/orders";
import * as rules from "@/server/services/delivery-rules";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };

export const addToCartAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ offerId: z.string(), qty: z.coerce.number().int().min(1).max(100000) }),
  handler: async (ctx, i) => done(await cart.addToCart(ctx, i.offerId, i.qty)),
});
export const setCartQtyAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ offerId: z.string(), qty: z.coerce.number().int().min(0).max(100000) }),
  handler: async (ctx, i) => done(await cart.setCartQty(ctx, i.offerId, i.qty)),
});
export const removeFromCartAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ offerId: z.string() }),
  handler: async (ctx, i) => done(await cart.removeFromCart(ctx, i.offerId)),
});
export const clearCartAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({}),
  handler: async (ctx) => done(await cart.clearCart(ctx)),
});
export const placeOrderAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ deliveryAddressId: z.string().min(1, "Choose a delivery address"), notes: z.string().max(500).optional().nullable(), requestedDeliveryDate: z.string().optional().nullable() }),
  handler: async (ctx, i) => done(await orders.placeOrder(ctx, { ...i, requestedDeliveryDate: i.requestedDeliveryDate ? new Date(i.requestedDeliveryDate) : null })),
});
export const changeOrderStatusAction = defineAction({
  permission: null, // buyer, vendor or admin — decided by the order service
  schema: z.object({
    orderId: z.string(),
    to: z.enum(["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED", "EXCEPTION"]),
    reason: z.string().trim().max(500).optional().nullable(),
  }),
  handler: async (ctx, i) => done(await orders.changeOrderStatus(ctx, i.orderId, i.to, i.reason)),
});
export const confirmOrderAction = defineAction({
  permission: ["vendor.orders.manage", "admin.orders.manage"],
  schema: z.object({ orderId: z.string(), quantities: z.record(z.coerce.number().int().min(0)) }),
  handler: async (ctx, i) => done(await orders.confirmOrder(ctx, i.orderId, i.quantities)),
});
export const resolveExceptionAction = defineAction({
  permission: "admin.orders.manage",
  schema: z.object({ exceptionId: z.string(), note: z.string().trim().min(3).max(500) }),
  handler: async (ctx, i) => done(await orders.resolveException(ctx, i.exceptionId, i.note)),
});
export const setFiringiRuleAction = defineAction({
  permission: "admin.delivery.manage",
  schema: z.object({ countryCode: z.string().length(2), minOrderValue: z.coerce.number().min(0), feeNet: z.coerce.number().min(0) }),
  handler: async (ctx, i) => done(await rules.setFiringiRule(ctx, i)),
});
export const setVendorMinimumAction = defineAction({
  permission: "vendor.service_areas.manage",
  schema: z.object({ amount: z.coerce.number().min(0).nullable() }),
  handler: async (ctx, i) => done(await rules.setVendorMinimum(ctx, i.amount)),
});
