"use server";
/** Advertising (Phase 34). Every service re-checks access. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as svc from "@/server/ads/service";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const placement = z.enum(["SEARCH", "CATEGORY", "HOME", "CART"]);
const money = z.number().min(0).max(1_000_000);

export const createCampaignAction = defineAction({
  permission: "vendor.promotions.manage",
  schema: z.object({
    name: z.string().max(120), placement, pricing: z.enum(["CPC", "DAILY"]), offerIds: z.array(z.string()).max(20), keywords: z.array(z.string().max(40)).max(20).optional(),
    categoryId: z.string().nullable().optional(), cpcBid: money.nullable().optional(), dailyBudget: money.nullable().optional(), totalBudget: money.nullable().optional(),
    startsOn: z.string().max(10), endsOn: z.string().max(10).nullable().optional(),
  }),
  handler: async (ctx, i) => { const c = await svc.createCampaign(ctx, i); return done({ id: c.id, status: c.status }); },
});
export const updateCampaignAction = defineAction({
  permission: "vendor.promotions.manage",
  schema: z.object({ id: z.string(), action: z.enum(["PAUSE", "RESUME", "END"]).optional(), cpcBid: money.optional(), dailyBudget: money.optional(), totalBudget: money.nullable().optional() }),
  handler: async (ctx, { id, ...c }) => { const r = await svc.updateCampaign(ctx, id, c); return done({ status: r.status }); },
});

const rule = z.object({ enabled: z.boolean(), slots: z.number().int(), minCpc: z.number(), dailyPrice: z.number() });
export const saveAdsSettingsAction = defineAction({
  permission: "admin.marketing.manage",
  schema: z.object({
    enabled: z.boolean(), approvalRequired: z.boolean(), defaultBilling: z.enum(["PAYOUT", "PREPAID", "INVOICE"]), invoiceDueDays: z.number().int(), clickDedupeMinutes: z.number().int(), lowBalance: z.number(),
    placements: z.object({ SEARCH: rule, CATEGORY: rule, HOME: rule, CART: rule }),
  }),
  handler: async (ctx, i) => done(await svc.saveAdsSettings(ctx, i)),
});
export const reviewCampaignAction = defineAction({
  permission: "admin.marketing.manage",
  schema: z.object({ id: z.string(), decision: z.enum(["APPROVE", "REJECT", "PAUSE", "END"]), reason: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { const r = await svc.reviewCampaign(ctx, i.id, i.decision, i.reason); return done({ status: r.status }); },
});
export const setAdBillingAction = defineAction({
  permission: ["admin.finance.manage", "admin.marketing.manage"],
  schema: z.object({ companyId: z.string(), billing: z.enum(["PAYOUT", "PREPAID", "INVOICE"]) }),
  handler: async (ctx, i) => { await svc.setAdBilling(ctx, i.companyId, i.billing); return done(true); },
});
export const recordTopUpAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({ companyId: z.string(), gross: z.number().positive().max(100_000), method: z.enum(["BANK_TRANSFER", "CARD", "MB_WAY", "MULTIBANCO", "OTHER"]), reference: z.string().max(80).nullable().optional() }),
  handler: async (ctx, { companyId, ...i }) => done(await svc.recordTopUp(ctx, companyId, i)),
});
export const invoiceAdsNowAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({ companyId: z.string().optional() }),
  handler: async (ctx, i) => done(await svc.invoiceAdCharges({ upTo: new Date(Date.now() + 86_400_000), companyId: i.companyId, actorUserId: ctx.user.id })),
});
export const runAdsNowAction = defineAction({ permission: "admin.marketing.manage", schema: z.object({}), handler: async () => done(await svc.runAdsJob()) });
