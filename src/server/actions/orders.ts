"use server";
/** Cart, checkout and order actions (services re-check every permission). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { ValidationError } from "@/server/errors";
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
/** Supplier: confirm several orders as ordered (each one on its own; failures are reported). */
export const bulkConfirmOrdersAction = defineAction({
  permission: "vendor.orders.manage",
  schema: z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(100) }),
  handler: async (ctx, i) => {
    const failed: string[] = [];
    for (const id of i.ids) await orders.confirmOrder(ctx, id, {}).catch((e: Error) => failed.push(e.message));
    if (failed.length === i.ids.length) throw new ValidationError(failed[0]);
    revalidatePath("/vendor/orders", "layout");
    return { confirmed: i.ids.length - failed.length, failed: failed.length };
  },
});
export const clearCartAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({}),
  handler: async (ctx) => done(await cart.clearCart(ctx)),
});
export const applyCouponAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ code: z.string().trim().min(1).max(40) }),
  handler: async (ctx, i) => done(await cart.applyCoupon(ctx, i.code)),
});
export const removeCouponAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({}),
  handler: async (ctx) => done(await cart.removeCoupon(ctx)),
});
export const placeOrderAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ deliveryAddressId: z.string().min(1, "Choose a delivery address"), notes: z.string().max(500).optional().nullable(), requestedDeliveryDate: z.string().optional().nullable(), poReference: z.string().max(60).optional().nullable() }),
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
  schema: z.object({
    countryCode: z.string().length(2).optional(), zoneId: z.string().min(1).optional(), minOrderValue: z.coerce.number().min(0), feeNet: z.coerce.number().min(0),
    freeEnabled: z.boolean().default(false), freeFrom: z.coerce.number().min(0).nullable().default(null),
  }),
  handler: async (ctx, i) => done(await rules.setFiringiRule(ctx, i)),
});
export const removeZoneRuleAction = defineAction({
  permission: "admin.delivery.manage",
  schema: z.object({ zoneId: z.string().min(1) }),
  handler: async (ctx, i) => done(await rules.removeZoneRule(ctx, i.zoneId)),
});
export const setVendorMinimumAction = defineAction({
  permission: "vendor.service_areas.manage",
  schema: z.object({
    rule: z.object({ kind: z.enum(["AMOUNT", "UNITS"]), amount: z.coerce.number().min(0).nullable().optional(), units: z.coerce.number().int().min(1).nullable().optional(), flatFeeNet: z.coerce.number().min(0).nullable().optional() }).nullable(),
  }),
  handler: async (ctx, i) => done(await rules.setVendorMinimum(ctx, i.rule)),
});
