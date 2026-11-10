"use server";
/** Coupons, customer offers and campaigns (services re-check permissions). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as promos from "@/server/services/promotions";
import * as camp from "@/server/marketing/campaigns";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const ids = z.array(z.string()).optional();
const texts = z.record(z.string(), z.string().max(2000));
const num = z.coerce.number().optional().nullable();
const int = z.coerce.number().int().optional().nullable();

const offerSchema = z.object({
  name: z.object({ en: z.string().trim().min(2).max(80), pt: z.string().trim().max(80).optional().nullable() }),
  description: z.object({ en: z.string().trim().max(300), pt: z.string().trim().max(300).optional().nullable() }).optional().nullable(),
  kind: z.enum(["PERCENT", "FIXED_AMOUNT", "ORDER_AMOUNT", "FREE_DELIVERY", "BUY_X_GET_Y"]),
  value: z.coerce.number().min(0),
  validFrom: z.string(), validTo: z.string().optional().nullable(),
  minQty: int, buyQty: int, freeQty: int, minOrderValue: num, budget: num, maxRedemptions: int, maxPerCustomer: int,
  code: z.string().trim().max(40).optional().nullable(), firstOrderOnly: z.boolean().optional(), showInOffers: z.boolean().optional(),
  targets: z.object({ offerIds: ids, productIds: ids, categoryIds: ids, vendorIds: ids, customerGroupIds: ids, buyerCompanyIds: ids, segmentIds: ids }),
  firingiFundPct: z.coerce.number().min(0).max(100).optional(),
  countryCode: z.string().length(2).optional().nullable(),
});
const toInput = (i: z.infer<typeof offerSchema>) => ({ ...i, validFrom: new Date(i.validFrom), validTo: i.validTo ? new Date(i.validTo) : null, description: i.description?.en ? i.description : null });

export const saveOfferAction = defineAction({ permission: ["admin.marketing.manage", "admin.pricing.manage"], schema: offerSchema, handler: async (ctx, i) => done(await promos.saveAdminPromotion(ctx, toInput(i))) });
export const saveVendorOfferAction = defineAction({ permission: "vendor.promotions.manage", schema: offerSchema, handler: async (ctx, i) => done(await promos.saveVendorPromotion(ctx, toInput(i))) });

const CH = z.enum(["EMAIL", "PUSH", "IN_APP", "SMS", "WHATSAPP"]);
const audience = z.object({ segmentId: z.string().optional().nullable(), types: z.array(z.enum(["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"])).optional(), countryCodes: z.array(z.string().length(2)).optional(), companyIds: ids });
const campaignSchema = z.object({
  id: z.string().optional().nullable(), name: z.string().trim().min(2).max(120), channels: z.array(CH), audience,
  subject: texts, body: texts, ctaLabel: texts.optional().nullable(), ctaPath: z.string().trim().max(200).optional().nullable(),
  promotionId: z.string().optional().nullable(), waTemplateName: z.string().trim().max(120).optional().nullable(), scheduledAt: z.string().optional().nullable(),
});

export const saveCampaignAction = defineAction({
  permission: "admin.marketing.manage", schema: campaignSchema,
  handler: async (ctx, i) => done({ id: (await camp.saveCampaign(ctx, i.id ?? null, { ...i, scheduledAt: i.scheduledAt ? new Date(i.scheduledAt) : null })).id }),
});
export const previewAudienceAction = defineAction({
  permission: ["admin.marketing.view", "admin.marketing.manage"], schema: z.object({ audience, channels: z.array(CH) }),
  handler: async (ctx, i) => camp.previewAudience(ctx, i.audience, i.channels),
});
export const sendCampaignAction = defineAction({ permission: "admin.marketing.manage", schema: z.object({ id: z.string() }), handler: async (ctx, i) => done(await camp.sendCampaign(ctx, i.id)) });
export const cancelCampaignAction = defineAction({ permission: "admin.marketing.manage", schema: z.object({ id: z.string() }), handler: async (ctx, i) => done(await camp.cancelCampaign(ctx, i.id)) });
export const duplicateCampaignAction = defineAction({ permission: "admin.marketing.manage", schema: z.object({ id: z.string() }), handler: async (ctx, i) => done({ id: (await camp.duplicateCampaign(ctx, i.id)).id }) });
