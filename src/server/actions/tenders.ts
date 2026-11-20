"use server";
/** Open tender actions (Phase 50). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as T from "@/server/tenders/service";

const id = z.string().min(1).max(64);
const ADMIN = ["admin.orders.manage", "admin.settings.manage"] as const;
const done = <V>(v: V) => { revalidatePath("/buy/orders/tenders", "layout"); revalidatePath("/vendor/orders/tenders", "layout"); revalidatePath("/admin/orders/tenders", "layout"); return v; };

// buyers
export const createTenderAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({
    title: z.string().max(120), note: z.string().max(1000).nullable().optional(), addressId: id, deliveryDate: z.string().max(10).nullable().optional(), closesAt: z.string().max(40), invitedIds: z.array(id).max(200).optional(),
    lines: z.array(z.object({ productId: id.nullable().optional(), description: z.string().max(300).nullable().optional(), qty: z.number().int().min(1).max(1_000_000), unitNote: z.string().max(60).nullable().optional(), targetUnitNet: z.number().min(0).max(1e7).nullable().optional() })).min(1).max(500),
  }),
  handler: async (ctx, i) => done({ id: (await T.createTender(ctx, i)).id }),
});
export const searchTenderProductsAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ q: z.string().max(80) }), handler: async (ctx, i) => T.searchProducts(ctx, i.q) });
export const cancelTenderAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ id }), handler: async (ctx, i) => { await T.cancelTender(ctx, i.id); return done(true); } });
export const closeTenderAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ id }), handler: async (ctx, i) => { await T.closeNow(ctx, i.id); return done(true); } });
export const awardTenderAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ id, picks: z.record(id, id.nullable()), payLaterTermId: z.string().max(20).nullable().optional(), poReference: z.string().max(60).nullable().optional() }),
  handler: async (ctx, i) => done(await T.award(ctx, i.id, i.picks, { payLaterTermId: i.payLaterTermId, poReference: i.poReference })),
});

// suppliers
export const submitBidAction = defineAction({
  permission: ["vendor.pricing.manage", "vendor.orders.manage"],
  schema: z.object({ tenderId: id, note: z.string().max(1000).nullable().optional(), lines: z.array(z.object({ lineId: id, offerId: id, unitNet: z.number().min(0).max(1e7) })).max(500) }),
  handler: async (ctx, i) => { await T.submitBid(ctx, i.tenderId, i); return done(true); },
});
export const withdrawBidAction = defineAction({ permission: ["vendor.pricing.manage", "vendor.orders.manage"], schema: z.object({ tenderId: id }), handler: async (ctx, i) => { await T.withdrawBid(ctx, i.tenderId); return done(true); } });

// FIRINGI
export const reviewTenderAction = defineAction({ permission: [...ADMIN], schema: z.object({ id, approve: z.boolean(), note: z.string().max(500).nullable() }), handler: async (ctx, i) => { await T.reviewTender(ctx, i.id, i.approve, i.note); return done(true); } });
export const setTenderSwitchAction = defineAction({ permission: [...ADMIN], schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }), handler: async (ctx, i) => { await T.setCompanySwitch(ctx, i.companyId, i.state); return done(true); } });
export const findTenderBusinessAction = defineAction({ permission: [...ADMIN, "admin.orders.view", "admin.finance.manage", "admin.catalogue.manage"], schema: z.object({ q: z.string().max(80) }), handler: async (ctx, i) => T.findBusiness(ctx, i.q) });
export const saveTenderSettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ enabled: z.boolean(), buyers: z.object({ CUSTOMER: z.boolean(), WHOLESALER: z.boolean() }), suppliers: z.object({ WHOLESALER: z.boolean(), DISTRIBUTOR: z.boolean() }), approval: z.enum(["ALWAYS", "AUTO"]), invitations: z.boolean(), targetPrices: z.boolean(), payLater: z.boolean(), maxLines: z.number(), minHours: z.number(), maxDays: z.number(), awardDays: z.number() }),
  handler: async (ctx, i) => done(await T.saveTenderSettings(ctx, i)),
});
