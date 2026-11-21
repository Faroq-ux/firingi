"use server";
/** EU trade reporting actions (Phase 57). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/trade/service";

const id = z.string().min(1).max(64);
const kg = z.number().positive().max(100000).nullable().optional();
const adminDone = () => { revalidatePath("/admin/invoices/eu-trade", "layout"); revalidatePath("/admin/settings/eu-trade"); return true; };
const country = z.object({
  ecslPeriod: z.enum(["MONTHLY", "QUARTERLY"]), ecslDueDay: z.number().int().min(1).max(28), intrastatDueDay: z.number().int().min(1).max(28),
  arrivalsThreshold: z.number().min(0).max(1e10), dispatchesThreshold: z.number().min(0).max(1e10), arrivalsObliged: z.boolean(), dispatchesObliged: z.boolean(),
  format: z.enum(["GENERIC", "PT", "ES", "FR", "DE"]),
});

export const saveTradeSettingsAction = defineAction({
  permission: ["admin.settings.manage", "admin.tax.manage"],
  schema: z.object({
    enabled: z.boolean(),
    returns: z.object({ ecsl: z.boolean(), arrivals: z.boolean(), dispatches: z.boolean(), supplierReports: z.boolean() }),
    crossBorderSales: z.boolean(),
    vies: z.object({ recheck: z.boolean(), maxAgeDays: z.number().int().min(0).max(365), onError: z.enum(["LOCAL_VAT", "LAST_VALID"]) }),
    codes: z.object({ supplierProposals: z.boolean(), categoryDefault: z.boolean() }),
    thresholds: z.object({ watch: z.boolean(), warnAtPct: z.number().int().min(1).max(100) }),
    reminders: z.object({ enabled: z.boolean(), days: z.array(z.number().int().min(0).max(60)).max(5) }),
    corrections: z.boolean(),
    defaults: z.object({ natureCode: z.string().max(2), transportMode: z.string().max(1), deliveryTerms: z.string().max(3) }),
    countries: z.record(z.string().length(2), country),
  }),
  handler: async (ctx, i) => { await S.saveTradeSettings(ctx, i); return adminDone(); },
});

export const refreshTradeAction = defineAction({
  permission: ["admin.tax.manage", "admin.finance.manage"],
  schema: z.object({}),
  handler: async (ctx) => { await S.tradeOverview(ctx); await S.refreshReturns(); return adminDone(); },
});

export const openTradeReturnAction = defineAction({
  permission: ["admin.tax.manage", "admin.finance.manage"],
  schema: z.object({ legalEntityId: id, kind: z.enum(["ECSL", "ARRIVALS", "DISPATCHES"]), period: z.string().max(7) }),
  handler: async (ctx, i) => { const r = await S.openReturn(ctx, i); adminDone(); return { id: r.id }; },
});

export const rebuildTradeReturnAction = defineAction({
  permission: ["admin.tax.manage", "admin.finance.manage"],
  schema: z.object({ id }),
  handler: async (ctx, i) => { await S.rebuildReturnAction(ctx, i.id); return adminDone(); },
});

export const readyTradeReturnAction = defineAction({
  permission: ["admin.tax.manage", "admin.finance.manage"],
  schema: z.object({ id }),
  handler: async (ctx, i) => { await S.markReady(ctx, i.id); return adminDone(); },
});

export const fileTradeReturnAction = defineAction({
  permission: ["admin.tax.manage", "admin.finance.manage"],
  schema: z.object({ id, reference: z.string().min(1).max(120), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { await S.markFiled(ctx, i.id, i); return adminDone(); },
});

export const reopenTradeReturnAction = defineAction({
  permission: "admin.tax.manage",
  schema: z.object({ id, reason: z.string().min(1).max(300) }),
  handler: async (ctx, i) => { await S.reopenReturn(ctx, i.id, i.reason); return adminDone(); },
});

export const recheckVatAction = defineAction({
  permission: ["admin.tax.manage", "admin.finance.manage"],
  schema: z.object({ companyId: id }),
  handler: async (ctx, i) => { const r = await S.recheckVat(ctx, i.companyId); adminDone(); return { result: r.result }; },
});

export const setCategoryCnAction = defineAction({
  permission: ["admin.catalogue.manage", "admin.tax.manage"],
  schema: z.object({ categoryId: id, cnCode: z.string().max(20).nullable(), suppUnit: z.string().max(12).nullable() }),
  handler: async (ctx, i) => { await S.setCategoryCn(ctx, i.categoryId, i); return adminDone(); },
});

export const setProductCustomsAction = defineAction({
  permission: ["admin.catalogue.manage", "admin.tax.manage"],
  schema: z.object({ productId: id, cnCode: z.string().max(20).nullable(), originCountryCode: z.string().max(2).nullable(), suppUnit: z.string().max(12).nullable(), packs: z.array(z.object({ id, netWeightKg: kg, suppUnits: kg })).max(30).optional() }),
  handler: async (ctx, i) => { await S.setProductCustoms(ctx, i.productId, i); return adminDone(); },
});

export const reviewCustomsAction = defineAction({
  permission: ["admin.catalogue.manage", "admin.tax.manage"],
  schema: z.object({ id, accept: z.boolean(), note: z.string().max(500).nullable().optional(), cnCode: z.string().max(20).nullable().optional(), netWeightKg: kg, suppUnits: kg, originCountryCode: z.string().max(2).nullable().optional() }),
  handler: async (ctx, i) => { await S.reviewProposal(ctx, i.id, i); return adminDone(); },
});

export const proposeCustomsAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({ productId: id, packagingUnitId: id.nullable().optional(), cnCode: z.string().max(20).nullable().optional(), netWeightKg: kg, suppUnits: kg, originCountryCode: z.string().max(2).nullable().optional(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { await S.proposeCustoms(ctx, i); revalidatePath("/vendor/products/customs"); return true; },
});
