"use server";
/** Add a product by barcode with AI: the supplier's steps and FIRINGI's switches. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as B from "@/server/catalogue/barcode-ai";

const code = z.string().trim().min(8).max(20);
export const startFromBarcodeAction = defineAction({
  permission: "vendor.products.manage", schema: z.object({ code }),
  handler: async (ctx, i) => B.startFromBarcode(ctx, i.code),
});
export const draftFromPhotosAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({ code, photos: z.array(z.object({ mime: z.string().max(40), base64: z.string().max(7_100_000) })).min(1).max(3) }),
  handler: async (ctx, i) => B.draftFromPhotos(ctx, i.code, i.photos),
});

const ADMIN = ["admin.catalogue.manage", "admin.settings.manage"] as const;
const re = <T,>(v: T) => { revalidatePath("/admin/catalogue/barcode-ai"); revalidatePath("/vendor/products/catalogue"); return v; };
export const saveBarcodeAiSettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({
    enabled: z.boolean(), sellers: z.object({ DISTRIBUTOR: z.boolean(), WHOLESALER: z.boolean() }),
    parts: z.object({ lookup: z.boolean(), ai: z.boolean(), photos: z.boolean() }),
    offCountries: z.array(z.string().length(2)).max(60), hourlyLimit: z.number().int().min(1).max(1000),
  }),
  handler: async (ctx, i) => re(await B.saveBarcodeAiSettings(ctx, i)),
});
export const setCompanyBarcodeAiAction = defineAction({
  permission: [...ADMIN], schema: z.object({ companyId: z.string().min(1).max(40), value: z.enum(["ON", "OFF"]).nullable() }),
  handler: async (ctx, i) => re(await B.setCompanyBarcodeAi(ctx, i.companyId, i.value)).enabled,
});
