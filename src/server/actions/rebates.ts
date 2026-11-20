"use server";
/** Rebates & bonuses actions (Phase 48). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/rebates/service";
import { REBATE_AUDIENCES, REBATE_KINDS, REBATE_PERIODS } from "@/lib/rebates";

const id = z.string().min(1).max(64);
const ids = z.array(id).max(2000);
const done = <T>(v: T) => { revalidatePath("/vendor/products/rebates", "layout"); revalidatePath("/buy/rewards/bonuses"); revalidatePath("/admin/pricing/rebates", "layout"); return v; };
const ADMIN = ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"] as const;

const bonus = z.object({
  id: id.nullable().optional(), sellerCompanyId: id.nullable().optional(),
  name: z.string().max(120), description: z.string().max(500).nullable().optional(),
  kind: z.enum(REBATE_KINDS), period: z.enum(REBATE_PERIODS), rules: z.record(z.unknown()),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}/), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional(),
  audience: z.enum(REBATE_AUDIENCES), segmentId: id.nullable().optional(), groupId: id.nullable().optional(), buyingGroupId: id.nullable().optional(), companyIds: ids.optional(),
  countries: z.array(z.string().length(2)).max(40).optional(), perShop: z.boolean().optional(),
  offerIds: ids.optional(), categoryIds: ids.optional(), brandIds: ids.optional(),
  rewardOfferId: id.nullable().optional(), freeGoodsDays: z.number().int().min(1).max(1000).nullable().optional(),
});

/** Save (and optionally send) a deal — supplier, or FIRINGI for its own deals. */
export const saveBonusAction = defineAction({
  permission: null, schema: bonus.extend({ submit: z.boolean().optional() }),
  handler: async (ctx, i) => {
    const { submit, ...input } = i;
    let b = await S.saveBonus(ctx, input);
    if (submit) b = await S.submitBonus(ctx, b.id);
    return done({ id: b.id, status: b.status });
  },
});
export const submitBonusAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => { const b = await S.submitBonus(ctx, i.id); return done({ status: b.status }); } });
export const endBonusAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => { const b = await S.endBonus(ctx, i.id); return done({ status: b.status }); } });
export const searchCustomersAction = defineAction({ permission: null, schema: z.object({ q: z.string().max(80) }), handler: async (ctx, i) => S.searchCustomers(ctx, i.q) });
export const bonusOptionsAction = defineAction({ permission: [...ADMIN], schema: z.object({ sellerId: id }), handler: async (ctx, i) => S.formOptions(ctx, i.sellerId) });

// FIRINGI
export const reviewBonusAction = defineAction({
  permission: [...ADMIN], schema: z.object({ id, approve: z.boolean(), note: z.string().max(500).nullable() }),
  handler: async (ctx, i) => { await S.reviewBonus(ctx, i.id, i.approve, i.note); return done(true); },
});
export const setSupplierSwitchAction = defineAction({
  permission: [...ADMIN], schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }),
  handler: async (ctx, i) => { await S.setSupplierSwitch(ctx, i.companyId, i.state); return done(true); },
});
export const retryRebatesAction = defineAction({ permission: [...ADMIN], schema: z.object({}), handler: async (ctx) => done(await S.retryFailed(ctx)) });
const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);
export const saveRebateSettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({
    enabled: z.boolean(), kinds: flags(REBATE_KINDS), periods: flags(REBATE_PERIODS), audiences: flags([...REBATE_AUDIENCES, "COUNTRY", "PER_SHOP"] as const),
    creators: flags(["DISTRIBUTOR", "WHOLESALER"] as const), buyers: flags(["CUSTOMER", "WHOLESALER"] as const), approval: z.enum(["ALWAYS", "AUTO"]),
    firingiFunded: z.boolean(), maxPct: z.number(), maxFixed: z.number(), freeGoodsDays: z.number(), settleDelayDays: z.number(), nudge: z.boolean(), nudgeDays: z.number(),
  }),
  handler: async (ctx, i) => done(await S.saveRebateSettings(ctx, i)),
});
