"use server";
/** Clearance deal actions (Phase 38). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/deals/service";
import { DEAL_KINDS } from "@/lib/deals";

const id = z.string().min(1).max(64);
const money = z.number().finite().positive().max(10_000_000);
const done = <T>(v: T) => { revalidatePath("/vendor/products/deals", "layout"); revalidatePath("/buy/catalogue", "layout"); revalidatePath("/admin/pricing/deals", "layout"); return v; };

// supplier
export const dealFormInfoAction = defineAction({ permission: null, schema: z.object({ offerId: id }), handler: async (ctx, i) => S.dealFormInfo(ctx, i.offerId) });
export const createDealAction = defineAction({
  permission: null,
  schema: z.object({
    offerId: id, kind: z.enum(DEAL_KINDS), title: z.string().max(80).nullable().optional(), note: z.string().max(200).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)), endsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)),
    maxQty: z.number().int().positive().max(1_000_000).nullable().optional(), perBuyerMax: z.number().int().positive().max(1_000_000).nullable().optional(),
    dealPrice: money.nullable().optional(), bundleQty: z.number().int().min(2).max(1000).nullable().optional(), bundlePrice: money.nullable().optional(),
    tiers: z.array(z.object({ minQty: z.number().int().positive().max(1_000_000), unitPrice: money })).max(6).nullable().optional(),
    lotPrice: money.nullable().optional(), floorPrice: money.nullable().optional(), minBidQty: z.number().int().positive().max(1_000_000).nullable().optional(), batchId: id.nullable().optional(),
  }),
  handler: async (ctx, i) => { const d = await S.createDeal(ctx, { ...i, startsAt: new Date(i.startsAt), endsAt: new Date(i.endsAt) }); return done({ id: d.id, number: d.number, status: d.status }); },
});
export const cancelDealAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => { await S.cancelDeal(ctx, i.id); return done(true); } });
export const answerBidAction = defineAction({
  permission: null, schema: z.object({ bidId: id, decision: z.enum(["ACCEPT", "REJECT", "COUNTER"]), counterPrice: money.nullable().optional() }),
  handler: async (ctx, i) => { await S.answerBid(ctx, i.bidId, i.decision, i.counterPrice); return done(true); },
});

// buyer
export const placeBidAction = defineAction({
  permission: null, schema: z.object({ dealId: id, qty: z.number().int().positive().max(1_000_000), unitPrice: money, message: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { const b = await S.placeBid(ctx, i.dealId, i.qty, i.unitPrice, i.message ?? null); return done({ status: b.status }); },
});
export const respondCounterAction = defineAction({ permission: null, schema: z.object({ bidId: id, accept: z.boolean() }), handler: async (ctx, i) => { await S.respondToCounter(ctx, i.bidId, i.accept); return done(true); } });
export const watchAction = defineAction({
  permission: null, schema: z.object({ kind: z.enum(["PRODUCT", "CATEGORY", "SUPPLIER"]), id, on: z.boolean() }),
  handler: async (ctx, i) => { await S.watch(ctx, { kind: i.kind, id: i.id }, i.on); return done(true); },
});
export const digestAction = defineAction({ permission: null, schema: z.object({ on: z.boolean() }), handler: async (ctx, i) => { await S.setDigest(ctx, i.on); return done(true); } });

// FIRINGI
export const reviewDealAction = defineAction({
  permission: ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"],
  schema: z.object({ id, approve: z.boolean(), note: z.string().max(300).nullable(), commissionPct: z.number().min(0).max(50).nullable().optional() }),
  handler: async (ctx, i) => { await S.reviewDeal(ctx, i.id, i.approve, i.note, i.commissionPct); return done(true); },
});
export const setTrustedAction = defineAction({ permission: ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"], schema: z.object({ companyId: id, on: z.boolean() }), handler: async (ctx, i) => { await S.setTrusted(ctx, i.companyId, i.on); return done(true); } });
export const saveDealSettingsAction = defineAction({
  permission: ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"],
  schema: z.object({
    kinds: z.object({ FLASH: z.boolean(), BUNDLE: z.boolean(), VOLUME: z.boolean(), LOT: z.boolean(), BEST_OFFER: z.boolean() }),
    approval: z.object({ mode: z.enum(["ALWAYS", "AUTO"]), maxDiscountPct: z.number(), maxDays: z.number(), trustedOnly: z.boolean() }),
    minDiscountPct: z.number(), maxDurationDays: z.number(),
    clearance: z.object({ expiryDays: z.number(), overstock: z.boolean(), commissionPct: z.number() }),
    bestOffer: z.object({ answerHours: z.number(), holdHours: z.number() }),
    alerts: z.object({ smart: z.boolean(), lookbackDays: z.number(), watch: z.boolean(), digest: z.boolean(), maxPerDay: z.number() }),
  }),
  handler: async (ctx, i) => done(await S.saveDealSettings(ctx, i)),
});
