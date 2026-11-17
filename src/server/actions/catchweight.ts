"use server";
/** Sold-by-weight actions (Phase 41). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/catchweight/service";

const id = z.string().min(1).max(64);
const kg = z.number().positive().lt(1000);
const done = <T>(v: T) => {
  for (const p of ["/vendor/orders", "/buy/orders", "/admin/orders", "/vendor/warehouse"]) revalidatePath(p, "layout");
  revalidatePath("/vendor/products/weights");
  return v;
};

export const saveCatchWeightSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), maxOverPct: z.record(z.string(), z.number().min(0).max(50)), prepayBufferPct: z.number().min(0).max(50),
    driverCorrection: z.boolean(), requireWeighing: z.boolean(),
    ean13: z.object({ prefixes: z.array(z.string().max(2)).max(10), itemDigits: z.number().int().min(4).max(6), valueDigits: z.number().int().min(4).max(6), gramsPerUnit: z.number().int() }),
  }),
  handler: async (ctx, i) => { await S.saveCatchWeightSettings(ctx, { ...i, maxOverPct: { default: i.maxOverPct.default ?? 10, ...i.maxOverPct } }); revalidatePath("/admin/settings/catch-weight"); return true; },
});

export const saveOfferCatchWeightAction = defineAction({
  permission: null,
  schema: z.object({
    offerId: id, mode: z.enum(["PIECE", "KG"]).nullable(), nominalKg: kg.nullable().optional(), minKg: kg.nullable().optional(), maxKg: kg.nullable().optional(),
    maxOverPct: z.number().min(0).max(50).nullable().optional(), plu: z.string().max(6).nullable().optional(), keepPerKg: z.boolean().optional(),
  }),
  handler: async (ctx, i) => { await S.saveOfferCatchWeight(ctx, i); return done(true); },
});

export const recordWeightsAction = defineAction({
  permission: null,
  schema: z.object({ orderLineId: id, pieces: z.array(kg).min(1).max(500), source: z.enum(["PICK", "SUPPLIER"]).optional(), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => done(await S.recordWeights(ctx, i)),
});

export const scanWeightLabelAction = defineAction({
  permission: null, schema: z.object({ orderLineId: id, code: z.string().min(1).max(120) }),
  handler: async (ctx, i) => done(await S.scanWeightLabel(ctx, i.orderLineId, i.code)),
});

export const acceptOverWeightAction = defineAction({
  permission: "buyer.orders.place", schema: z.object({ orderId: id, lineId: id.nullable().optional() }),
  handler: async (ctx, i) => { await S.acceptOverWeight(ctx, i.orderId, i.lineId ?? null); return done(true); },
});
