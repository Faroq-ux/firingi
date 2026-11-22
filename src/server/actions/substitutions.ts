"use server";
/** Substitutions (Phase 60). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/substitutions/service";

const id = z.string().min(1).max(64);
const mode = z.enum(["ASK", "AUTO", "NEVER"]);
function refresh() {
  for (const p of ["/vendor/orders", "/buy/orders", "/admin/orders"]) revalidatePath(p, "layout");
}

export const saveSubstitutionSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), allowAuto: z.boolean(), allowPriceMatch: z.boolean(), responseMinutes: z.number().int().min(5).max(1440),
    defaultMode: mode, defaultMaxPricePct: z.number().int().min(0).max(100), defaultAcceptOnTimeout: z.boolean(),
  }),
  handler: async (ctx, i) => { await S.saveSubstitutionSettings(ctx, i); refresh(); return true; },
});

export const saveSubstitutionPreferencesAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ mode, maxPricePct: z.number().int().min(0).max(100), sameBrandOnly: z.boolean(), acceptOnTimeout: z.boolean() }),
  handler: async (ctx, i) => { await S.savePreferences(ctx, i); refresh(); return true; },
});

export const setSubstitutionProductRuleAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ productId: id, mode: mode.nullable() }),
  handler: async (ctx, i) => { await S.setProductRule(ctx, i.productId, i.mode); refresh(); return true; },
});

export const boughtProductsAction = defineAction({
  permission: null, schema: z.object({ q: z.string().max(80).nullable().optional() }),
  handler: async (ctx, i) => S.boughtProducts(ctx, i.q ?? null),
});

export const ownOffersAction = defineAction({
  permission: null, schema: z.object({ q: z.string().max(80).nullable().optional() }),
  handler: async (ctx, i) => S.ownOffers(ctx, i.q ?? null),
});

export const substituteLinksAction = defineAction({
  permission: null, schema: z.object({ offerId: id }),
  handler: async (ctx, i) => S.substituteLinks(ctx, i.offerId),
});

export const setSubstituteLinksAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({ offerId: id, substituteOfferIds: z.array(id).max(10) }),
  handler: async (ctx, i) => { await S.setSubstituteLinks(ctx, i.offerId, i.substituteOfferIds); refresh(); return true; },
});

export const substitutionCandidatesAction = defineAction({
  permission: null, schema: z.object({ lineId: id }),
  handler: async (ctx, i) => S.candidatesFor(ctx, i.lineId),
});

export const proposeSubstitutionAction = defineAction({
  permission: null,
  schema: z.object({ lineId: id, shortQty: z.number().int().min(1).max(100000), substituteOfferId: id, qty: z.number().int().min(1).max(100000), priceMatch: z.boolean().optional(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await S.propose(ctx, i); refresh(); return r; },
});

export const decideSubstitutionAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ id, accept: z.boolean(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await S.decide(ctx, i.id, i.accept, i.note ?? null); refresh(); return r; },
});

export const withdrawSubstitutionAction = defineAction({
  permission: null, schema: z.object({ id }),
  handler: async (ctx, i) => { await S.withdraw(ctx, i.id); refresh(); return true; },
});
