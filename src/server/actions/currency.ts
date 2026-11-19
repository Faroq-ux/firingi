"use server";
/** Multi-currency actions (Phase 45). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { AppError } from "@/server/errors";
import * as S from "@/server/currency/service";
import { LOCAL_COUNTRIES, LOCAL_CURRENCIES } from "@/lib/currency";

const done = () => { for (const p of ["/admin/international/currency", "/admin/international/exchange-rates", "/admin/international/currency/alerts"]) revalidatePath(p); return true; };
const flags = (keys: readonly string[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<string, z.ZodBoolean>);

const marginSchema = z.object(Object.fromEntries(LOCAL_CURRENCIES.map((c) => [c, z.number().min(0).max(10)])) as Record<string, z.ZodNumber>);
const settingsSchema = z.object({
  enabled: z.boolean(), countries: flags(LOCAL_COUNTRIES), showEur: z.boolean(), supplierCurrency: z.boolean(), payoutsLocal: z.boolean(), localPriceLists: z.boolean(),
  margins: marginSchema,
  feed: z.enum(["ECB", "MANUAL"]), autoFetch: z.boolean(), alertMovePct: z.number().min(0.1).max(25), alertFeedFailure: z.boolean(), staleDays: z.number().int().min(1).max(30),
  invoiceEurEquivalent: z.boolean(), fxAccounting: z.boolean(), reportSwitch: z.boolean(),
});

export const saveCurrencySettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: settingsSchema,
  handler: async (ctx, i) => { await S.saveCurrencySettings(ctx, i); return done(); },
});

export const overrideRateAction = defineAction({
  permission: ["admin.settings.manage", "admin.international.manage"],
  schema: z.object({ code: z.string().length(3), rate: z.number().positive(), date: z.string().max(10).nullable().optional(), note: z.string().max(200).nullable().optional() }),
  handler: async (ctx, i) => { await S.overrideRate(ctx, i); return done(); },
});

export const clearOverrideAction = defineAction({
  permission: ["admin.settings.manage", "admin.international.manage"],
  schema: z.object({ id: z.string().min(1).max(64) }),
  handler: async (ctx, i) => { await S.clearOverride(ctx, i.id); return done(); },
});

export const fetchRatesAction = defineAction({
  permission: ["admin.settings.manage", "admin.international.manage"],
  schema: z.object({}),
  handler: async () => {
    const r = await S.runFxJob({ force: true });
    done();
    if (r.failed) throw new AppError("FEED_FAILED", `The ECB rates could not be read (${r.failed}). Conversions keep using the last rates; see Rate Alerts.`, 502);
    return r;
  },
});

export const ackFxEventAction = defineAction({
  permission: ["admin.settings.manage", "admin.international.manage", "admin.finance.manage"],
  schema: z.object({ id: z.string().min(1).max(64) }),
  handler: async (ctx, i) => { await S.ackFxEvent(ctx, i.id === "ALL" ? "ALL" : i.id); return done(); },
});
