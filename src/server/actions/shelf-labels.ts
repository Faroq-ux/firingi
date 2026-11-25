"use server";
/** Shelf price labels: shops add products (purchases with a margin, or till items), edit prices / promos; FIRINGI's switches. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { defineAction } from "./_action";
import * as S from "@/server/labels/service";

const SHOP = ["buyer.orders.place", "company.pos.manage"] as const;
const ADMIN = ["admin.settings.manage", "admin.catalogue.manage"] as const;
const page = <T,>(v: T) => { revalidatePath("/buy/catalogue/shelf-labels"); return v; };
const id = z.string().min(1).max(40);
const ids = z.array(id).min(1).max(500);

export const addLabelsFromPurchasesAction = defineAction({
  permission: [...SHOP],
  schema: z.object({ offerIds: ids, marginPct: z.number().min(0).max(500), rounding: z.enum(["NINE", "CENT"]) }),
  handler: async (ctx, i) => page(await S.addFromPurchases(ctx, i.offerIds, i.marginPct, i.rounding, await getLocale())),
});
export const addLabelsFromTillAction = defineAction({
  permission: [...SHOP], schema: z.object({ posItemIds: ids }),
  handler: async (ctx, i) => page(await S.addFromTill(ctx, i.posItemIds)),
});
export const updateLabelAction = defineAction({
  permission: [...SHOP],
  schema: z.object({
    id, name: z.string().max(120).optional(), barcode: z.string().max(14).nullable().optional(), brand: z.string().max(80).nullable().optional(),
    originCountryCode: z.string().max(2).nullable().optional(), priceGross: z.number().positive().max(100000).optional(), marginPct: z.number().min(0).max(500).nullable().optional(),
    promoPrice: z.number().positive().max(100000).nullable().optional(), promoUntil: z.coerce.date().nullable().optional(),
    content: z.number().min(0).max(100000).nullable().optional(), contentUnit: z.enum(["KG", "L", "UNIT"]).nullable().optional(), syncTill: z.boolean().optional(),
  }),
  handler: async (ctx, { id: labelId, ...e }) => { page(await S.updateLabel(ctx, labelId, e)); return true; },
});
export const applyLabelPricesAction = defineAction({ permission: [...SHOP], schema: z.object({ ids }), handler: async (ctx, i) => page(await S.applyNewPrices(ctx, i.ids)) });
export const removeLabelsAction = defineAction({ permission: [...SHOP], schema: z.object({ ids }), handler: async (ctx, i) => { page(await S.removeLabels(ctx, i.ids)); return true; } });

const are = <T,>(v: T) => { revalidatePath("/admin/catalogue/shelf-labels"); revalidatePath("/buy", "layout"); return v; };
export const saveShelfLabelSettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({
    enabled: z.boolean(), buyers: z.object({ CUSTOMER: z.boolean(), WHOLESALER: z.boolean() }),
    allowBrand: z.boolean(), allowOrigin: z.boolean(), allowQr: z.boolean(), allowPosSync: z.boolean(), offCountries: z.array(z.string().length(2)).max(60),
  }),
  handler: async (ctx, i) => { are(await S.saveSlSettings(ctx, i)); return true; },
});
export const setCompanyShelfLabelsAction = defineAction({
  permission: [...ADMIN], schema: z.object({ companyId: id, value: z.enum(["ON", "OFF"]).nullable() }),
  handler: async (ctx, i) => { are(await S.setCompanySl(ctx, i.companyId, i.value)); return true; },
});
