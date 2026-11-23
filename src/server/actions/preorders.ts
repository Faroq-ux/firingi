"use server";
/** Pre-orders & price locks (Phase 71): sellers, buyers and FIRINGI (the services re-check every right and switch). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { firstIssue } from "@/server/ai/ops/parse";
import { calloffSchema, campaignSchema, decideSchema, id, lockSchema, reservationSchema, settingsSchema } from "@/server/preorders/schema";

const camp = () => import("@/server/preorders/campaigns");
const locks = () => import("@/server/preorders/locks");
const SELL = ["vendor.promotions.manage", "vendor.pricing.manage"] as const;
const ADMIN = ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"] as const;
const re = <T>(v: T) => { revalidatePath("/vendor/orders/preorders", "layout"); revalidatePath("/buy/orders/preorders", "layout"); revalidatePath("/admin/orders/preorders", "layout"); return v; };
const d = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);

export const saveCampaignAction = defineAction({
  permission: [...SELL], schema: z.object({ id: id.nullable(), input: z.unknown() }),
  handler: async (ctx, i) => {
    const v = firstIssue(campaignSchema, i.input);
    const c = await (await camp()).saveCampaign(ctx, { ...v, opensAt: d(v.opensAt), closesAt: d(v.closesAt), deliveryDates: v.deliveryDates.map(d) }, i.id);
    return re({ id: c.id });
  },
});
export const submitCampaignAction = defineAction({ permission: [...SELL], schema: z.object({ id }), handler: async (ctx, i) => re({ status: (await (await camp()).submitCampaign(ctx, i.id)).status }) });
export const cancelCampaignAction = defineAction({ permission: [...SELL, ...ADMIN], schema: z.object({ id, reason: z.string().max(300) }), handler: async (ctx, i) => re(await (await camp()).cancelCampaign(ctx, i.id, i.reason)) });
export const closeCampaignNowAction = defineAction({ permission: [...SELL], schema: z.object({ id }), handler: async (ctx, i) => re(await (await camp()).closeNow(ctx, i.id)) });
export const orderCampaignNowAction = defineAction({ permission: [...SELL], schema: z.object({ id, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), handler: async (ctx, i) => re(await (await camp()).orderNow(ctx, i.id, d(i.date))) });
export const reviewCampaignAction = defineAction({ permission: [...ADMIN], schema: z.object({ id, approve: z.boolean(), note: z.string().max(500).nullable().optional() }), handler: async (ctx, i) => re({ status: (await (await camp()).reviewCampaign(ctx, i.id, i.approve, i.note)).status }) });

export const placePreorderAction = defineAction({
  permission: "buyer.orders.place", schema: z.object({ input: z.unknown() }),
  handler: async (ctx, i) => { const v = firstIssue(reservationSchema, i.input); return re(await (await camp()).placeReservation(ctx, { ...v, deliveryDate: d(v.deliveryDate) })); },
});
export const cancelPreorderAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ id }), handler: async (ctx, i) => re(await (await camp()).cancelReservation(ctx, i.id)) });
export const answerAllocationAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ id, accept: z.boolean() }), handler: async (ctx, i) => re(await (await camp()).answerAllocation(ctx, i.id, i.accept)) });

export const requestLockAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ input: z.unknown() }), handler: async (ctx, i) => re({ id: (await (await locks()).requestLock(ctx, firstIssue(lockSchema, i.input))).id }) });
export const cancelLockAction = defineAction({ permission: ["buyer.orders.place", ...ADMIN], schema: z.object({ id }), handler: async (ctx, i) => re(await (await locks()).cancelLock(ctx, i.id)) });
export const callOffAction = defineAction({
  permission: "buyer.orders.place", schema: z.object({ input: z.unknown() }),
  handler: async (ctx, i) => { const v = firstIssue(calloffSchema, i.input); const r = await (await locks()).callOff(ctx, v.id, { qty: v.qty, addressId: v.addressId, deliveryDate: v.deliveryDate ? d(v.deliveryDate) : null }); return re({ order: r.order, left: r.left }); },
});
export const decideLockAction = defineAction({ permission: [...SELL], schema: z.object({ input: z.unknown() }), handler: async (ctx, i) => { const v = firstIssue(decideSchema, i.input); return re(await (await locks()).decideLock(ctx, v.id, v)); } });
export const reviewLockAction = defineAction({ permission: [...ADMIN], schema: z.object({ id, approve: z.boolean(), note: z.string().max(500).nullable().optional() }), handler: async (ctx, i) => re(await (await locks()).reviewLock(ctx, i.id, i.approve, i.note)) });

export const savePreSettingsAction = defineAction({ permission: [...ADMIN], schema: z.object({ input: z.unknown() }), handler: async (ctx, i) => { await (await import("@/server/preorders/settings")).savePreSettings(ctx, firstIssue(settingsSchema, i.input)); return re({ ok: true }); } });
export const setCompanyPreAction = defineAction({ permission: [...ADMIN], schema: z.object({ companyId: id, value: z.enum(["ON", "OFF"]).nullable() }), handler: async (ctx, i) => { await (await import("@/server/preorders/settings")).setCompanyPre(ctx, i.companyId, i.value); return re({ ok: true }); } });
export const runPreordersJobAction = defineAction({ permission: [...ADMIN], schema: z.object({}), handler: async (ctx) => { if (ctx.company.type !== "ADMIN") throw new (await import("@/server/errors")).ForbiddenError(); return re(await (await import("@/server/preorders/job")).processPreorders()); } });
