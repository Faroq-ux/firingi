"use server";
/** Phase 9 actions: allocation rules, supplier profiles, manual moves, open cases. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { updateAllocationRules, type AllocationRules } from "@/server/allocation/rules";
import { dismissEvent, manualMove, processOverdue, saveVendorProfile } from "@/server/allocation/engine";

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
