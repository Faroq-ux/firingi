"use server";
/** Phase 12 actions: plan, change, start and cancel routes; routing settings. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { autoPlan, cancelRoute, createRoute, moveStop, removeFromRoute, reoptimiseRoute, setRoutingSettings, startRoute, type RoutingSettings } from "@/server/services/routes";

const done = <T>(v: T) => { revalidatePath("/admin/delivery", "layout"); revalidatePath("/vendor/fleet", "layout"); revalidatePath("/driver", "layout"); return v; };
const DISPATCH = ["admin.delivery.manage", "vendor.orders.manage", "vendor.drivers.manage"] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));

export const createRouteAction = defineAction({
  permission: [...DISPATCH],
  schema: z.object({ date: day, driverId: z.string().min(1), vehicleId: z.string().nullable().optional(), deliveryIds: z.array(z.string().min(1)).min(1).max(50) }),
  handler: async (ctx, i) => { const r = await createRoute(ctx, i); return done({ id: r.id, number: r.number }); },
});

export const autoPlanAction = defineAction({
  permission: [...DISPATCH],
  schema: z.object({ date: day }),
  handler: async (ctx, i) => done(await autoPlan(ctx, i.date)),
});

export const reoptimiseRouteAction = defineAction({ permission: [...DISPATCH], schema: z.object({ id: z.string().min(1) }), handler: async (ctx, i) => done(await reoptimiseRoute(ctx, i.id)) });
export const moveStopAction = defineAction({
  permission: [...DISPATCH],
  schema: z.object({ routeId: z.string().min(1), stopId: z.string().min(1), dir: z.union([z.literal(-1), z.literal(1)]) }),
  handler: async (ctx, i) => done(await moveStop(ctx, i.routeId, i.stopId, i.dir)),
});
export const removeFromRouteAction = defineAction({
  permission: [...DISPATCH],
  schema: z.object({ routeId: z.string().min(1), deliveryId: z.string().min(1) }),
  handler: async (ctx, i) => done(await removeFromRoute(ctx, i.routeId, i.deliveryId)),
});
export const cancelRouteAction = defineAction({ permission: [...DISPATCH], schema: z.object({ id: z.string().min(1) }), handler: async (ctx, i) => done(await cancelRoute(ctx, i.id)) });
/** The driver (or the dispatcher) starts the route. */
export const startRouteAction = defineAction({ permission: [...DISPATCH, "driver.deliveries.update"], schema: z.object({ id: z.string().min(1) }), handler: async (ctx, i) => done(await startRoute(ctx, i.id)) });

export const setRoutingSettingsAction = defineAction({
  permission: ["admin.delivery.manage", "admin.settings.manage"],
  schema: z.object({ patch: z.record(z.string(), z.unknown()) }),
  handler: async (ctx, i) => done(await setRoutingSettings(ctx, i.patch as Partial<RoutingSettings>)),
});
