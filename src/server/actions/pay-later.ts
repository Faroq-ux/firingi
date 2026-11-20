"use server";
/** Pay later actions (Phase 50). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as P from "@/server/pay-later/service";

const id = z.string().min(1).max(64);
const ADMIN = ["admin.finance.manage", "admin.settings.manage"] as const;
const done = <T>(v: T) => { revalidatePath("/buy/finance/pay-later"); revalidatePath("/admin/finance/pay-later", "layout"); return v; };

/** Checkout: the options for this gross amount. */
export const payLaterOptionsAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ gross: z.number().min(0).max(1e8) }), handler: async (ctx, i) => P.checkoutOptions(ctx, i.gross) });

const term = z.object({ id: z.string().max(20), kind: z.enum(["DAYS", "INSTALMENTS"]), days: z.number(), count: z.number(), enabled: z.boolean(), feePct: z.number(), feeFixed: z.number(), feePayer: z.enum(["BUYER", "FIRINGI", "SHARED"]), buyerSharePct: z.number() });
const model = z.object({ partner: z.boolean(), own: z.boolean(), first: z.enum(["PARTNER", "OWN"]) });
export const savePayLaterSettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ enabled: z.boolean(), buyers: z.object({ CUSTOMER: z.boolean(), WHOLESALER: z.boolean() }), terms: z.array(term).max(30), countries: z.record(z.string().max(2), model), defaults: model, ownLimit: z.object({ CUSTOMER: z.number(), WHOLESALER: z.number() }), minOrder: z.number(), remindDays: z.number() }),
  handler: async (ctx, i) => done(await P.savePayLaterSettings(ctx, i)),
});
export const setPayLaterSwitchAction = defineAction({ permission: [...ADMIN], schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }), handler: async (ctx, i) => { await P.setCompanySwitch(ctx, i.companyId, i.state); return done(true); } });
export const setOwnLimitAction = defineAction({ permission: [...ADMIN], schema: z.object({ companyId: id, limit: z.number().min(0).max(1e7).nullable() }), handler: async (ctx, i) => { await P.setOwnLimit(ctx, i.companyId, i.limit); return done(true); } });
