"use server";
/** Phase 9 actions: allocation rules, supplier profiles, manual moves, open cases. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { updateAllocationRules, type AllocationRules } from "@/server/allocation/rules";
import { setCustomerOrderMode } from "@/server/allocation/mode";
import { assignPickupRun } from "@/server/allocation/data";
import { buyerDecision, dismissEvent, manualMove, processOverdue, saveVendorProfile } from "@/server/allocation/engine";

const done = <T>(v: T) => { revalidatePath("/admin/allocation", "layout"); return v; };
const P = "admin.allocation.manage" as const;

export const updateAllocationRulesAction = defineAction({
  permission: P,
  schema: z.object({ patch: z.record(z.string(), z.unknown()) }),
  handler: async (ctx, i) => done(await updateAllocationRules(ctx, i.patch as Partial<AllocationRules>)),
});

export const saveVendorProfileAction = defineAction({
  permission: P,
  schema: z.object({
    companyId: z.string().min(1), priority: z.coerce.number().int().optional(), excluded: z.boolean().optional(),
    dailyOrderCapacity: z.number().int().nullable().optional(), note: z.string().max(500).nullable().optional(),
  }),
  handler: async (ctx, { companyId, ...rest }) => done((await saveVendorProfile(ctx, companyId, rest)).id),
});

export const manualMoveAction = defineAction({
  permission: P,
  schema: z.object({ orderId: z.string().min(1), vendorId: z.string().min(1), marginOverride: z.boolean().optional(), note: z.string().trim().max(500).nullable().optional() }),
  handler: async (ctx, i) => {
    const ev = await manualMove(ctx, i);
    return done({ status: ev?.status ?? null, newOrders: (ev?.newOrders ?? []) as { orderId: string; number: string }[] });
  },
});

export const dismissAllocationAction = defineAction({
  permission: P,
  schema: z.object({ eventId: z.string().min(1), note: z.string().trim().min(1).max(500) }),
  handler: async (ctx, i) => done(await dismissEvent(ctx, i.eventId, i.note)),
});

export const runOverdueAction = defineAction({ permission: P, schema: z.object({}), handler: async () => done(await processOverdue()) });

/** The buyer decides when the wholesaler it chose can't deliver. */
export const buyerDecisionAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ eventId: z.string().min(1), choice: z.enum(["FIRINGI", "CANCEL"]) }),
  // No revalidation: the panel shows the result (with links); a refresh would remove it.
  handler: async (ctx, i) => buyerDecision(ctx, i.eventId, i.choice),
});

export const setCustomerOrderModeAction = defineAction({
  permission: ["admin.international.manage", "admin.allocation.manage"],
  schema: z.object({ countryId: z.string().min(1), mode: z.enum(["CHOOSE_SUPPLIER", "FIRINGI"]) }),
  handler: async (ctx, i) => { await setCustomerOrderMode(ctx, i.countryId, i.mode); revalidatePath("/", "layout"); },
});

export const assignPickupRunAction = defineAction({
  permission: ["admin.delivery.manage"],
  schema: z.object({ deliveryIds: z.array(z.string().min(1)).min(1).max(50), driverId: z.string().min(1) }),
  handler: async (ctx, i) => done(await assignPickupRun(ctx, i.deliveryIds, i.driverId)),
});
