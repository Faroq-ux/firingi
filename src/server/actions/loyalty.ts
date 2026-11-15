"use server";
/** Loyalty & rewards (Phase 32). Every service re-checks access. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as svc from "@/server/loyalty/service";
import { setCartPoints } from "@/server/services/cart";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const int = z.number().int();

export const setCartPointsAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ points: int.min(0).max(10_000_000) }), handler: async (ctx, i) => done(await setCartPoints(ctx, i.points)) });
export const redeemCreditAction = defineAction({ permission: ["buyer.invoices.view", "buyer.payments.view"], schema: z.object({ points: int.min(1).max(10_000_000) }), handler: async (ctx, i) => done(await svc.redeemAsCreditNote(ctx, i.points)) });

const tier = z.object({ minSpend: z.number().min(0).max(100_000_000), multiplier: z.number().min(1).max(5), freeDelivery: z.boolean(), prioritySupport: z.boolean() });
export const saveLoyaltySettingsAction = defineAction({
  permission: "admin.marketing.manage",
  schema: z.object({
    enabled: z.boolean(), pointsPerEuro: z.number(), pointValue: z.number(), minRedeem: int, maxRedeemPct: z.number(), creditNoteMin: int, expiryMonths: int, reminderDays: int,
    tiers: z.object({ BRONZE: tier, SILVER: tier, GOLD: tier }), referral: z.object({ inviter: int, invited: int }), startsOn: z.string().max(10).nullable().optional(),
  }),
  handler: async (ctx, i) => done(await svc.saveLoyaltySettings(ctx, i)),
});
const campaign = z.object({
  name: z.string().trim().max(120), message: z.string().trim().max(300).optional().nullable(), multiplier: z.number(),
  startsAt: z.coerce.date(), endsAt: z.coerce.date(), vendorIds: z.array(z.string()).max(200), categoryIds: z.array(z.string()).max(200), offerIds: z.array(z.string()).max(500),
});
export const saveCampaignAction = defineAction({
  permission: "admin.marketing.manage", schema: campaign.extend({ id: z.string().optional() }),
  handler: async (ctx, { id, message, ...i }) => done(await svc.saveCampaign(ctx, { ...i, message: message ? { en: message } : null }, id)),
});
export const endCampaignAction = defineAction({ permission: "admin.marketing.manage", schema: z.object({ id: z.string() }), handler: async (ctx, i) => done(await svc.endCampaign(ctx, i.id)) });
export const adjustPointsAction = defineAction({
  permission: "admin.marketing.manage", schema: z.object({ companyId: z.string(), points: int, reason: z.string().trim().max(300) }),
  handler: async (ctx, i) => done(await svc.adjustPoints(ctx, i.companyId, i.points, i.reason)),
});
export const runLoyaltyNowAction = defineAction({ permission: "admin.marketing.manage", schema: z.object({}), handler: async () => done(await svc.runLoyaltyJob()) });
