"use server";
/** Rewards shop actions (Phase 55). The service checks rights again (buyer / supplier / FIRINGI, FIRINGI's switches). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as R from "@/server/rewards/service";
import { REWARD_BUYER_TYPES, REWARD_KINDS, REWARD_SUPPLIER_TYPES, REWARD_TIERS } from "@/lib/rewards";

const id = z.string().min(1).max(64);
const texts = z.record(z.string().min(2).max(5), z.string().max(4000));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const toDate = (d: string | null | undefined, end = false) => (d ? new Date(`${d}T${end ? "23:59:59" : "00:00:00"}Z`) : null);
const done = <T>(v: T) => {
  for (const p of ["/buy/rewards", "/vendor/products/rewards", "/admin/marketing/rewards"]) revalidatePath(p, "layout");
  revalidatePath("/buy/orders/cart");
  revalidatePath("/admin/settings/rewards");
  return v;
};
const BUY = ["buyer.orders.view", "buyer.orders.place"] as const;
const ADMIN_MKT = ["admin.marketing.manage"] as const;

// ── buyer ───────────────────────────────────────────────────────────────────
export const redeemRewardAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ id, addressId: id.nullable().optional(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => done(await R.redeemReward(ctx, i.id, { addressId: i.addressId ?? null, note: i.note ?? null })),
});
export const applyRedemptionAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ id }), handler: async (ctx, i) => done(await R.applyRedemption(ctx, i.id)) });
export const cancelMyRedemptionAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ id }), handler: async (ctx, i) => done(await R.buyerCancelRedemption(ctx, i.id)) });
export const setRewardGoalAction = defineAction({ permission: [...BUY], schema: z.object({ id: id.nullable() }), handler: async (ctx, i) => done(await R.setRewardGoal(ctx, i.id)) });

// ── supplier ────────────────────────────────────────────────────────────────
export const saveSupplierRewardAction = defineAction({
  permission: "vendor.promotions.manage",
  schema: z.object({
    id: id.nullable(), offerId: id, qty: z.number().int(), points: z.number().int(), stock: z.number().int().nullable(), perBuyerLimit: z.number().int().nullable(),
    minTier: z.enum(REWARD_TIERS).nullable(), title: texts, description: texts.nullable(), validTo: date,
  }),
  handler: async (ctx, i) => done(await R.saveSupplierReward(ctx, { ...i, id: i.id ?? undefined, validTo: toDate(i.validTo, true) })),
});
export const supplierRewardStatusAction = defineAction({
  permission: "vendor.promotions.manage", schema: z.object({ id, status: z.enum(["ACTIVE", "PAUSED", "ENDED"]) }),
  handler: async (ctx, i) => done(await R.setSupplierRewardStatus(ctx, i.id, i.status)),
});
export const supplierCancelRedemptionAction = defineAction({
  permission: "vendor.promotions.manage", schema: z.object({ id, reason: z.string().max(500) }),
  handler: async (ctx, i) => done(await R.supplierCancelRedemption(ctx, i.id, i.reason)),
});

// ── FIRINGI ─────────────────────────────────────────────────────────────────
export const saveAdminRewardAction = defineAction({
  permission: [...ADMIN_MKT],
  schema: z.object({
    id: id.nullable(), kind: z.enum(REWARD_KINDS), points: z.number().int(), stock: z.number().int().nullable(), perBuyerLimit: z.number().int().nullable(),
    minTier: z.enum(REWARD_TIERS).nullable(), buyerTypes: z.array(z.enum(REWARD_BUYER_TYPES)), countryCodes: z.array(z.string().max(2)).max(40),
    validFrom: date, validTo: date, featured: z.boolean(), sortOrder: z.number().int(), title: texts, description: texts.nullable(), terms: texts.nullable(),
    voucherAmount: z.number().nullable(), voucherMinOrder: z.number().nullable(), voucherDays: z.number().int().nullable(), giftCost: z.number().nullable(),
    partnerName: z.string().max(120).nullable(), partnerUrl: z.string().max(500).nullable(), status: z.enum(["DRAFT", "ACTIVE"]).optional(),
  }),
  handler: async (ctx, i) => done(await R.saveAdminReward(ctx, { ...i, id: i.id ?? undefined, validFrom: toDate(i.validFrom), validTo: toDate(i.validTo, true) })),
});
export const reviewRewardAction = defineAction({
  permission: [...ADMIN_MKT], schema: z.object({ id, approve: z.boolean(), note: z.string().max(1000).nullable() }),
  handler: async (ctx, i) => done(await R.reviewSupplierReward(ctx, i.id, i.approve, i.note)),
});
export const rewardStatusAction = defineAction({
  permission: [...ADMIN_MKT], schema: z.object({ id, status: z.enum(["ACTIVE", "PAUSED", "ENDED"]) }),
  handler: async (ctx, i) => done(await R.setRewardStatus(ctx, i.id, i.status)),
});
export const addPartnerCodesAction = defineAction({
  permission: [...ADMIN_MKT], schema: z.object({ id, text: z.string().max(2_000_000) }),
  handler: async (ctx, i) => done(await R.addPartnerCodes(ctx, i.id, i.text)),
});
export const removeUnusedCodesAction = defineAction({ permission: [...ADMIN_MKT], schema: z.object({ id }), handler: async (ctx, i) => done(await R.removeUnusedCodes(ctx, i.id)) });
export const fulfilGiftAction = defineAction({
  permission: [...ADMIN_MKT], schema: z.object({ id, action: z.enum(["SHIP", "DELIVER"]), tracking: z.string().max(200).nullable() }),
  handler: async (ctx, i) => done(await R.fulfilGift(ctx, i.id, i.action, i.tracking)),
});
export const adminCancelRedemptionAction = defineAction({
  permission: [...ADMIN_MKT], schema: z.object({ id, reason: z.string().max(500) }),
  handler: async (ctx, i) => done(await R.adminCancelRedemption(ctx, i.id, i.reason)),
});
export const saveRewardsSettingsAction = defineAction({
  permission: [...ADMIN_MKT],
  schema: z.object({
    enabled: z.boolean(), kinds: z.record(z.enum(REWARD_KINDS), z.boolean()), buyerTypes: z.record(z.enum(REWARD_BUYER_TYPES), z.boolean()),
    supplierTypes: z.record(z.enum(REWARD_SUPPLIER_TYPES), z.boolean()), supplierApproval: z.boolean(), supplierMinPoints: z.number(), supplierMaxPoints: z.number(),
    handoverDays: z.number(), voucherDays: z.number(), refundExpired: z.boolean(), buyerCancel: z.boolean(), reminderDays: z.number(), lowStock: z.number(), monthlyLimit: z.number(),
  }),
  handler: async (ctx, i) => done(await R.saveRewardsSettings(ctx, i as Parameters<typeof R.saveRewardsSettings>[1])),
});
export const setRewardsSwitchAction = defineAction({
  permission: [...ADMIN_MKT], schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }),
  handler: async (ctx, i) => done(await R.setRewardsSwitch(ctx, i.companyId, i.state)),
});
export const findRewardsBusinessAction = defineAction({
  permission: ["admin.marketing.view", "admin.marketing.manage"], schema: z.object({ q: z.string().max(100) }),
  handler: async (ctx, i) => R.findRewardsBusiness(ctx, i.q),
});

/** Reward picture (multipart: id, file; no file = remove). */
export async function setRewardImageAction(fd: FormData) {
  return runAction(async (ctx) => {
    const f = fd.get("file");
    await R.setRewardImage(ctx, id.parse(String(fd.get("id") ?? "")), f instanceof File && f.size > 0 ? f : null);
    return done(true);
  });
}
