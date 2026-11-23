"use server";
/** Price benchmark (Phase 70): FIRINGI's settings and rebuild (customers only read; add-to-cart uses the cart action). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";

const ADMIN = ["admin.pricing.manage", "admin.settings.manage"] as const;
const settingsSchema = z.object({
  enabled: z.boolean(), audiences: z.object({ customers: z.boolean(), wholesalers: z.boolean() }), supplierView: z.boolean(),
  parts: z.object({ savings: z.boolean(), alternatives: z.boolean(), basket: z.boolean(), trend: z.boolean(), ai: z.boolean(), monthlyMessage: z.boolean() }),
  minBuyers: z.coerce.number(), periodDays: z.coerce.number(), refreshHours: z.coerce.number(), notifyMinSaving: z.coerce.number(), risePp: z.coerce.number(),
  excludedCategoryIds: z.array(z.string().max(40)).max(200), offCountries: z.array(z.string().max(2)).max(40), offTypes: z.array(z.string().max(30)).max(20),
});
const done = <T>(v: T) => { revalidatePath("/admin/pricing/intelligence/benchmark"); return v; };
export const saveBenchSettingsAction = defineAction({ permission: [...ADMIN], schema: settingsSchema, handler: async (ctx, i) => { await (await import("@/server/benchmark/settings")).saveBenchSettings(ctx, i); return done({ ok: true }); } });
export const rebuildBenchmarkAction = defineAction({
  permission: [...ADMIN], schema: z.object({}),
  handler: async (ctx) => { if (ctx.company.type !== "ADMIN") throw new (await import("@/server/errors")).ForbiddenError(); const r = await (await import("@/server/benchmark/job")).processBenchmark(new Date(), true); return done({ groups: r.groups }); },
});
export const setCompanyBenchAction = defineAction({
  permission: [...ADMIN], schema: z.object({ companyId: z.string().min(1).max(40), value: z.enum(["ON", "OFF"]).nullable() }),
  handler: async (ctx, i) => { await (await import("@/server/benchmark/settings")).setCompanyBench(ctx, i.companyId, i.value); return done({ ok: true }); },
});
