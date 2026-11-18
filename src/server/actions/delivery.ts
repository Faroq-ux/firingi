"use server";
/** Phase 6 actions: service areas, zones, fleet, deliveries, returns, multi-order settings. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as areas from "@/server/services/service-areas";
import * as fleet from "@/server/services/fleet";
import * as deliveries from "@/server/services/deliveries";
import * as returns from "@/server/services/returns";
import * as settings from "@/server/services/delivery-settings";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const id = z.string().min(1);
const optStr = z.string().trim().max(500).optional().nullable();
const num = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const file = (v: FormDataEntryValue | null) => (v instanceof File && v.size > 0 ? v : null);
const files = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);

/** A signature drawn on the canvas arrives as a PNG data URL. */
function dataUrlToFile(v: FormDataEntryValue | null, name: string): File | null {
  if (typeof v !== "string" || !v.startsWith("data:image/png;base64,")) return null;
  const buf = Buffer.from(v.slice("data:image/png;base64,".length), "base64");
  return buf.length > 100 ? new File([buf], name, { type: "image/png" }) : null;
}

// ── service areas & zones ───────────────────────────────────────────────────

export const addServiceAreaAction = defineAction({
  permission: "vendor.service_areas.manage",
  schema: z.object({
    type: z.enum(["COUNTRY", "REGION", "CITY", "ZONE", "RADIUS_KM"]),
    countryId: z.string().optional().nullable(), regionId: z.string().optional().nullable(), cityId: z.string().optional().nullable(),
    zoneId: z.string().optional().nullable(), originAddressId: z.string().optional().nullable(), radiusKm: z.coerce.number().optional().nullable(),
  }),
  handler: async (ctx, i) => done((await areas.addServiceArea(ctx, i)).id),
});
export const removeServiceAreaAction = defineAction({ permission: "vendor.service_areas.manage", schema: z.object({ id }), handler: async (ctx, i) => done(await areas.removeServiceArea(ctx, i.id)) });

const zoneSchema = z.object({ countryCode: z.string().length(2), name: z.string().trim().min(2).max(80), postalCodePatterns: z.array(z.string()).max(200), polygon: z.string().max(500_000).optional().nullable() });
function parsePolygon(text?: string | null) {
  if (!text?.trim()) return null;
  try {
    const g = JSON.parse(text);
    return g?.type === "Feature" ? g.geometry : g?.type === "FeatureCollection" ? g.features?.[0]?.geometry : g;
  } catch {
    return { invalid: true };
  }
}
export const createZoneAction = defineAction({
  permission: "admin.delivery.manage",
  schema: zoneSchema,
  handler: async (ctx, i) => done((await areas.createZone(ctx, { ...i, polygon: parsePolygon(i.polygon) })).id),
});
export const updateZoneAction = defineAction({
  permission: "admin.delivery.manage",
  schema: zoneSchema.extend({ id }),
  handler: async (ctx, i) => done(await areas.updateZone(ctx, i.id, { ...i, polygon: parsePolygon(i.polygon) })),
});
export const setZoneActiveAction = defineAction({ permission: "admin.delivery.manage", schema: z.object({ id, active: z.boolean() }), handler: async (ctx, i) => done(await areas.setZoneActive(ctx, i.id, i.active)) });

// ── fleet ───────────────────────────────────────────────────────────────────

export const addVehicleAction = defineAction({
  permission: ["vendor.vehicles.manage", "admin.fleet.manage"],
  schema: z.object({ plate: z.string().trim().min(2).max(15), type: z.string(), make: optStr, model: optStr, capacityKg: z.string().optional().nullable(), capacityM3: z.string().optional().nullable(), isRefrigerated: z.boolean().optional() }),
  handler: async (ctx, i) => done((await fleet.addVehicle(ctx, i)).id),
});
export const setVehicleStatusAction = defineAction({
  permission: ["vendor.vehicles.manage", "admin.fleet.manage"],
  schema: z.object({ id, status: z.enum(["ACTIVE", "MAINTENANCE", "INACTIVE"]), reason: optStr }),
  handler: async (ctx, i) => done(await fleet.setVehicleStatus(ctx, i.id, i.status, i.reason)),
});
export const addDriverAction = defineAction({
  permission: ["vendor.drivers.manage", "admin.fleet.manage"],
  schema: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email(), phone: optStr, password: z.string().min(10).max(200), licenceNumber: z.string().trim().min(4).max(40), licenceExpiry: z.string().optional().nullable() }),
  handler: async (ctx, i) => done((await fleet.addDriver(ctx, { ...i, licenceExpiry: i.licenceExpiry ? new Date(i.licenceExpiry) : null })).id),
});
export const setDriverActiveAction = defineAction({
  permission: ["vendor.drivers.manage", "admin.fleet.manage"],
  schema: z.object({ id, active: z.boolean(), reason: optStr }),
  handler: async (ctx, i) => done(await fleet.setDriverActive(ctx, i.id, i.active, i.reason)),
});
export const setAvailabilityAction = defineAction({
  permission: null,
  schema: z.object({ availability: z.enum(["AVAILABLE", "BUSY", "OFF_DUTY"]), driverId: z.string().optional() }),
  handler: async (ctx, i) => done(await fleet.setAvailability(ctx, i.availability, i.driverId)),
});

// ── deliveries ──────────────────────────────────────────────────────────────

export const assignDeliveryAction = defineAction({
  permission: ["vendor.orders.manage", "admin.delivery.manage"],
  schema: z.object({ id, driverId: z.string().nullable(), vehicleId: z.string().optional().nullable(), scheduledFor: z.string().optional().nullable(), notes: optStr }),
  handler: async (ctx, i) => done(await deliveries.assignDelivery(ctx, i.id, { driverId: i.driverId || null, vehicleId: i.vehicleId || null, scheduledFor: i.scheduledFor ? new Date(i.scheduledFor) : null, notes: i.notes })),
});
export const setCarrierAction = defineAction({
  permission: ["vendor.orders.manage", "admin.delivery.manage"],
  schema: z.object({ id, carrierName: z.string().trim().min(2).max(80), trackingNumber: optStr }),
  handler: async (ctx, i) => done(await deliveries.setCarrier(ctx, i.id, i)),
});
export const returnToSupplierAction = defineAction({
  permission: ["vendor.orders.manage", "admin.delivery.manage"],
  schema: z.object({ id, reason: z.string().trim().min(2).max(500) }),
  handler: async (ctx, i) => done(await deliveries.returnToSupplier(ctx, i.id, i.reason)),
});
export const driverStepAction = defineAction({
  permission: "driver.deliveries.update",
  schema: z.object({ id, step: z.enum(["PICK_UP", "START"]) }),
  handler: async (ctx, i) => done(i.step === "PICK_UP" ? await deliveries.pickUp(ctx, i.id).then(() => null) : await deliveries.startDelivery(ctx, i.id).then(() => null)),
});
export async function completeDeliveryAction(fd: FormData) {
  return runAction(async (ctx) =>
    done(await deliveries.completeDelivery(ctx, str(fd.get("id")), {
      recipientName: str(fd.get("recipientName")), note: str(fd.get("note")) || null,
      signature: dataUrlToFile(fd.get("signature"), "signature.png"), photos: files(fd, "photos"),
      latitude: num(fd.get("latitude")), longitude: num(fd.get("longitude")),
      empties: emptiesFrom(fd),
      weights: weightsFrom(fd), acceptOver: fd.get("acceptOver") === "on" || fd.get("acceptOver") === "true",
      temps: tempsFrom(fd) as Record<string, number> | null, refuseClasses: fd.getAll("refuse").map(String).filter(Boolean),
    })),
  );
}
/** Phase 42: "temp:<classId>" fields = °C at the handover (as typed; checked in the service). */
function tempsFrom(fd: FormData): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("temp:") && typeof v === "string" && v.trim()) out[k.slice(5)] = v.trim();
  return Object.keys(out).length ? out : null;
}
/** Phase 41: "weight:<orderLineId>" fields = kg weighed at the stop (empty = unchanged). */
function weightsFrom(fd: FormData): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("weight:") || typeof v !== "string" || !v.trim()) continue;
    const kg = Number(v.replace(",", "."));
    if (Number.isFinite(kg) && kg > 0) out[k.slice(7)] = kg;
  }
  return Object.keys(out).length ? out : null;
}
/** Phase 40: "empty:<typeId>" fields = empties counted at the stop (none sent = not counted). */
function emptiesFrom(fd: FormData): Record<string, number> | null {
  const out: Record<string, number> = {};
  let any = false;
  for (const [k, v] of fd.entries()) if (k.startsWith("empty:")) { any = true; out[k.slice(6)] = Math.max(0, Math.floor(Number(v) || 0)); }
  return any ? out : null;
}
export async function failDeliveryAction(fd: FormData) {
  return runAction(async (ctx) =>
    done(await deliveries.failDelivery(ctx, str(fd.get("id")), {
      reasonCode: str(fd.get("reasonCode")), note: str(fd.get("note")) || null, photo: file(fd.get("photo")),
      latitude: num(fd.get("latitude")), longitude: num(fd.get("longitude")),
    })),
  );
}

// ── returns ─────────────────────────────────────────────────────────────────

export async function requestReturnAction(fd: FormData) {
  return runAction(async (ctx) => {
    const lines = fd.getAll("line").map((v) => {
      const [orderLineId, qty] = String(v).split(":");
      return { orderLineId, qty: Number(qty) };
    });
    return done((await returns.requestReturn(ctx, str(fd.get("orderId")), { lines, reason: str(fd.get("reason")), photos: files(fd, "photos") })).id);
  });
}
export const reviewReturnAction = defineAction({
  permission: "admin.orders.manage",
  schema: z.object({ id, decision: z.enum(["APPROVED", "REJECTED"]), note: optStr }),
  handler: async (ctx, i) => done(await returns.reviewReturn(ctx, i.id, i.decision, i.note)),
});
export const receiveReturnAction = defineAction({
  permission: ["vendor.orders.manage", "admin.orders.manage"],
  schema: z.object({ id, restock: z.boolean() }),
  handler: async (ctx, i) => done(await returns.receiveReturn(ctx, i.id, { restock: i.restock })),
});

// ── multi-order delivery ────────────────────────────────────────────────────

export const setMultiOrderPolicyAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ firingiFleet: z.boolean(), firingiMax: z.coerce.number().int(), vendorsMayUse: z.boolean(), vendorMaxCap: z.coerce.number().int() }),
  handler: async (ctx, i) => done(await settings.setMultiOrderPolicy(ctx, i)),
});
export const setVendorMultiOrderAction = defineAction({
  permission: ["vendor.drivers.manage", "vendor.service_areas.manage"],
  schema: z.object({ enabled: z.boolean(), max: z.coerce.number().int() }),
  handler: async (ctx, i) => done(await settings.setVendorMultiOrder(ctx, i)),
});
