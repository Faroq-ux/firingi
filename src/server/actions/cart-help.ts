"use server";
/** FIRINGI's switches for buying from several wholesalers: supplier minimums help and supplier names. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as H from "@/server/catalogue/cart-help";

const ADMIN = ["admin.settings.manage", "admin.catalogue.manage"] as const;
const re = <T,>(v: T) => { revalidatePath("/admin/catalogue/suppliers-shown"); revalidatePath("/buy", "layout"); return v; };
const mode = z.enum(["NAME", "AREA"]);

export const saveCartHelpAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ enabled: z.boolean(), cartFirst: z.boolean(), badges: z.boolean(), suggestions: z.boolean(), offCountries: z.array(z.string().length(2)).max(60) }),
  handler: async (ctx, i) => { re(await H.saveCartHelpSettings(ctx, i)); return true; },
});
export const saveSupplierNamesAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({ customers: mode, wholesalers: mode, countries: z.record(z.string().length(2), mode) }),
  handler: async (ctx, i) => { re(await H.saveSupplierNameSettings(ctx, i)); return true; },
});
export const setSupplierNameModeAction = defineAction({
  permission: [...ADMIN], schema: z.object({ companyId: z.string().min(1).max(40), value: mode.nullable() }),
  handler: async (ctx, i) => { re(await H.setCompanyNameMode(ctx, i.companyId, i.value)); return true; },
});
