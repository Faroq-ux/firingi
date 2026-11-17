"use server";
/** Returnables & deposits actions (Phase 40). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { defineAction } from "./_action";
import * as S from "@/server/returnables/service";
import { RETURNABLE_CATEGORIES } from "@/lib/returnables";

const id = z.string().min(1).max(64);
const qty = z.number().int().min(0).max(10_000);
const done = <T>(v: T) => { revalidatePath("/vendor/orders/empties", "layout"); revalidatePath("/vendor/products/returnables"); revalidatePath("/buy/orders/empties", "layout"); revalidatePath("/admin/orders/empties", "layout"); revalidatePath("/buy/orders/cart"); return v; };
const lines = z.array(z.object({ typeId: id, accepted: qty, damaged: qty })).max(30);

// supplier (own types) and FIRINGI (shared list)
export const saveTypeAction = defineAction({
  permission: null,
  schema: z.object({ id: id.nullable().optional(), code: z.string().min(1).max(40), name: z.string().min(1).max(80), category: z.enum(RETURNABLE_CATEGORIES), kind: z.enum(["DEPOSIT", "EXCHANGE"]), depositNet: z.number().min(0).max(5000), active: z.boolean().optional() }),
  handler: async (ctx, i) => { const t = await S.saveType(ctx, i, await getLocale()); return done({ id: t.id }); },
});
export const linkOfferAction = defineAction({
  permission: null, schema: z.object({ offerId: id, typeId: id, qtyPerUnit: z.number().int().min(1).max(1000) }),
  handler: async (ctx, i) => { await S.linkOffer(ctx, i.offerId, i.typeId, i.qtyPerUnit); return done(true); },
});
export const unlinkOfferAction = defineAction({ permission: null, schema: z.object({ offerId: id, typeId: id }), handler: async (ctx, i) => { await S.unlinkOffer(ctx, i.offerId, i.typeId); return done(true); } });
export const confirmReturnAction = defineAction({ permission: null, schema: z.object({ id, lines }), handler: async (ctx, i) => { const r = await S.confirmReturn(ctx, i.id, i.lines); return done({ status: r.status, credit: Number(r.creditGross) }); } });
export const dropOffAction = defineAction({
  permission: null, schema: z.object({ customerId: id, lines, note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await S.recordDropOff(ctx, i.customerId, i.lines, i.note ?? null); return done({ id: r.id, number: r.number, credit: Number(r.creditGross) }); },
});
export const adjustBalanceAction = defineAction({
  permission: null, schema: z.object({ customerId: id, typeId: id, qty: z.number().int().min(-10_000).max(10_000), note: z.string().max(300) }),
  handler: async (ctx, i) => { await S.adjustBalance(ctx, i.customerId, i.typeId, i.qty, i.note); return done(true); },
});
export const planPickupAction = defineAction({
  permission: null, schema: z.object({ id, driverId: id, plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  handler: async (ctx, i) => { await S.planPickup(ctx, i.id, i.driverId, new Date(`${i.plannedDate}T09:00:00`)); return done(true); },
});
export const cancelPickupAction = defineAction({ permission: null, schema: z.object({ id }), handler: async (ctx, i) => { await S.cancelPickup(ctx, i.id); return done(true); } });

// customer
export const requestPickupAction = defineAction({
  permission: null,
  schema: z.object({ supplierId: id, addressId: id, lines: z.array(z.object({ typeId: id, qty })).max(30), note: z.string().max(500).nullable().optional(), preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }),
  handler: async (ctx, i) => { const p = await S.requestPickup(ctx, { ...i, preferredDate: i.preferredDate ? new Date(`${i.preferredDate}T09:00:00`) : null }); return done({ id: p.id, number: p.number }); },
});
export const disputeReturnAction = defineAction({ permission: null, schema: z.object({ id, note: z.string().max(1000) }), handler: async (ctx, i) => { await S.disputeReturn(ctx, i.id, i.note); return done(true); } });
export const setCartSwapAction = defineAction({
  permission: null, schema: z.object({ supplierId: id, typeId: id, qty }),
  handler: async (ctx, i) => { await S.setCartSwap(ctx, i.supplierId, i.typeId, i.qty); return done(true); },
});

// driver
export const collectPickupAction = defineAction({
  permission: null, schema: z.object({ id, counted: z.record(z.string().max(64), qty) }),
  handler: async (ctx, i) => { const r = await S.collectPickup(ctx, i.id, i.counted); return done({ number: r?.number ?? null }); },
});

// FIRINGI
export const resolveDisputeAction = defineAction({
  permission: null, schema: z.object({ id, decision: z.enum(["CUSTOMER", "SUPPLIER"]), note: z.string().max(500) }),
  handler: async (ctx, i) => { await S.resolveDispute(ctx, i.id, i.decision, i.note); return done(true); },
});
export const saveReturnableSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), creditDamaged: z.boolean(), pickups: z.boolean(), pickupMinUnits: z.number().int().min(1).max(500),
    overdue: z.object({ days: z.number().int().min(7).max(730), action: z.enum(["REMIND", "KEEP"]), remindEveryDays: z.number().int().min(1).max(90) }),
    vat: z.record(z.string().regex(/^[A-Z]{2}$/), z.object({ mode: z.enum(["NONE", "PRODUCT", "FIXED"]), rate: z.number().min(0).max(30).optional() })),
    suppliers: z.record(id, z.object({ days: z.number().int().min(7).max(730), action: z.enum(["REMIND", "KEEP"]) })),
  }),
  handler: async (ctx, i) => { await S.saveReturnableSettings(ctx, i); return done(true); },
});
