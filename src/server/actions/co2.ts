"use server";
/** Sustainability & CO₂ actions (Phase 51). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as C from "@/server/co2/service";
import { FUELS, PACKAGINGS } from "@/lib/co2";

const id = z.string().min(1).max(64);
const ADMIN = ["admin.catalogue.manage", "admin.settings.manage"] as const;
const done = <T>(v: T) => { revalidatePath("/vendor/products/co2"); revalidatePath("/buy/reports/co2"); revalidatePath("/admin/catalogue/co2", "layout"); return v; };

export const saveOfferCo2Action = defineAction({
  permission: ["vendor.products.manage", "vendor.pricing.manage"],
  schema: z.object({ offerId: id, kgPerKg: z.number().min(0).max(200).nullable(), packaging: z.enum(PACKAGINGS).nullable(), recyclable: z.boolean(), source: z.string().max(300).nullable() }),
  handler: async (ctx, i) => done(await C.saveOfferCo2(ctx, i.offerId, i)),
});
export const setCo2GoalAction = defineAction({ permission: null, schema: z.object({ year: z.number().int(), reductionPct: z.number().nullable() }), handler: async (ctx, i) => { await C.setGoal(ctx, i.year, i.reductionPct); return done(true); } });
export const reviewOfferCo2Action = defineAction({ permission: [...ADMIN, "admin.catalogue.approve"], schema: z.object({ offerId: id, approve: z.boolean(), note: z.string().max(500).nullable() }), handler: async (ctx, i) => { await C.reviewOfferCo2(ctx, i.offerId, i.approve, i.note); return done(true); } });
export const saveCategoryFactorAction = defineAction({ permission: [...ADMIN], schema: z.object({ categoryId: id, kgPerKg: z.number().min(0).max(200).nullable(), source: z.string().max(200).nullable() }), handler: async (ctx, i) => { await C.saveCategoryFactor(ctx, i.categoryId, i.kgPerKg, i.source); return done(true); } });
export const setCo2SwitchAction = defineAction({ permission: [...ADMIN], schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }), handler: async (ctx, i) => { await C.setCompanySwitch(ctx, i.companyId, i.state); return done(true); } });
export const setVehicleFuelAction = defineAction({ permission: null, schema: z.object({ vehicleId: id, fuel: z.enum(FUELS).nullable() }), handler: async (ctx, i) => { await C.setVehicleFuel(ctx, i.vehicleId, i.fuel); revalidatePath("/vendor/delivery", "layout"); revalidatePath("/admin/fleet", "layout"); return true; } });
const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);
const nums = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.number()])) as Record<K, z.ZodNumber>);
export const saveCo2SettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({
    enabled: z.boolean(), parts: flags(["products", "delivery", "packaging", "local"] as const), show: flags(["badges", "orders", "reports", "export", "alternatives", "goals", "supplierScore"] as const),
    buyers: flags(["CUSTOMER", "WHOLESALER"] as const), suppliers: flags(["WHOLESALER", "DISTRIBUTOR"] as const), approval: z.enum(["ALWAYS", "AUTO"]),
    lowPct: z.number(), localKm: z.number(), roadFactor: z.number(), fuels: nums(FUELS), defaultFuel: z.enum(FUELS), packaging: nums(PACKAGINGS), fallbackKgPerKg: z.number(), fallbackUnitKg: z.number(),
  }),
  handler: async (ctx, i) => done(await C.saveCo2Settings(ctx, i)),
});
