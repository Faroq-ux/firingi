"use server";
/** Cold-chain actions (Phase 42). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/coldchain/service";

const id = z.string().min(1).max(64);
const temp = z.union([z.number(), z.string().max(12)]);
const temps = z.record(z.string().max(64), temp);
const done = <T>(v: T) => {
  for (const p of ["/vendor/orders", "/buy/orders", "/admin/orders", "/driver/deliveries", "/vendor/fleet/cold-chain", "/admin/delivery/cold-chain"]) revalidatePath(p, "layout");
  return v;
};

export const saveColdChainSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(),
    record: z.object({ supplierDispatch: z.boolean(), driverLoading: z.boolean(), driverHandover: z.boolean(), customerReceipt: z.boolean(), loggers: z.boolean() }),
    requireHandover: z.boolean(),
    actions: z.object({ customerRefuse: z.boolean(), alert: z.boolean(), block: z.boolean(), score: z.boolean() }),
    records: z.object({ certificate: z.boolean(), monthly: z.boolean(), equipment: z.boolean(), receivingLog: z.boolean() }),
    loggerAlertMinutes: z.number().int().min(1).max(240),
  }),
  handler: async (ctx, i) => { await S.saveColdChainSettings(ctx, i); revalidatePath("/admin/settings/cold-chain"); return true; },
});

export const saveClassAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id: id.nullable().optional(), code: z.string().max(30), nameEn: z.string().max(60), namePt: z.string().max(60).nullable().optional(), minC: z.number().nullable().optional(), maxC: z.number().nullable().optional(), toleranceC: z.number().min(0).max(10).optional(), coldChain: z.boolean(), active: z.boolean().optional(), sortOrder: z.number().int().optional() }),
  handler: async (ctx, i) => { const r = await S.saveClass(ctx, i); revalidatePath("/admin/catalogue/temperature-classes"); return { id: r.id }; },
});

export const setCategoryClassAction = defineAction({
  permission: "admin.catalogue.manage", schema: z.object({ categoryId: id, tempClassId: id.nullable() }),
  handler: async (ctx, i) => { await S.setCategoryClass(ctx, i.categoryId, i.tempClassId); revalidatePath("/admin/catalogue/temperature-classes"); return true; },
});

export const setOfferClassAction = defineAction({
  permission: null, schema: z.object({ offerId: id, tempClassId: id.nullable() }),
  handler: async (ctx, i) => { await S.setOfferClass(ctx, i.offerId, i.tempClassId); revalidatePath("/vendor/products/temperature"); return true; },
});

export const recordDispatchAction = defineAction({
  permission: null, schema: z.object({ orderId: id, temps, probe: z.string().max(40).nullable().optional() }),
  handler: async (ctx, i) => done(await S.recordDispatch(ctx, i.orderId, i.temps, i.probe ?? null)),
});
export const recordLoadingAction = defineAction({
  permission: null, schema: z.object({ deliveryId: id, temps, probe: z.string().max(40).nullable().optional() }),
  handler: async (ctx, i) => done(await S.recordLoading(ctx, i.deliveryId, i.temps, i.probe ?? null)),
});
export const recordReceiptAction = defineAction({
  permission: null, schema: z.object({ orderId: id, temps, accepted: z.boolean(), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => done(await S.recordReceipt(ctx, i.orderId, i.temps, i.accepted, i.note ?? null)),
});

export const addReceivingEntryAction = defineAction({
  permission: null,
  schema: z.object({ supplierName: z.string().max(120), product: z.string().max(160), tempClassId: id, valueC: temp, accepted: z.boolean(), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await S.addReceivingEntry(ctx, i); revalidatePath("/buy/orders/receiving"); return true; },
});

export const createLoggerAction = defineAction({
  permission: null, schema: z.object({ name: z.string().max(80), serial: z.string().max(60).nullable().optional(), vehicleId: id.nullable().optional(), equipmentId: id.nullable().optional(), tempClassId: id.nullable().optional() }),
  handler: async (ctx, i) => done(await S.createLogger(ctx, i)),
});
export const setLoggerActiveAction = defineAction({ permission: null, schema: z.object({ id, active: z.boolean() }), handler: async (ctx, i) => { await S.setLoggerActive(ctx, i.id, i.active); return done(true); } });

export const saveEquipmentAction = defineAction({
  permission: null,
  schema: z.object({
    id: id.nullable().optional(), kind: z.enum(["VEHICLE_UNIT", "COLD_ROOM", "FREEZER", "PROBE"]), name: z.string().max(80), vehicleId: id.nullable().optional(), tempClassId: id.nullable().optional(), serial: z.string().max(60).nullable().optional(),
    checkEveryDays: z.number().int().min(0).max(730).nullable().optional(), cleanEveryDays: z.number().int().min(0).max(730).nullable().optional(), calibrateEveryDays: z.number().int().min(0).max(730).nullable().optional(), active: z.boolean().optional(),
  }),
  handler: async (ctx, i) => { const r = await S.saveEquipment(ctx, i); return done({ id: r.id }); },
});
export const addEquipmentLogAction = defineAction({
  permission: null, schema: z.object({ equipmentId: id, kind: z.enum(["CHECK", "CLEANING", "CALIBRATION", "SERVICE"]), ok: z.boolean(), valueC: temp.nullable().optional(), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await S.addEquipmentLog(ctx, i.equipmentId, i); return done(true); },
});
