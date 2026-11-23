"use server";
/** Food safety logbook (Phase 69): customers / wholesalers and FIRINGI (the service re-checks every right). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import { firstIssue } from "@/server/ai/ops/parse";
import { coolingSchema, deliverySchema, id, settingsSchema, taskSchema, tempSchema, trainingSchema, unitSchema } from "@/server/haccp/schema";
import { ValidationError } from "@/server/errors";

const svc = () => import("@/server/haccp/service");
const buy = <T>(v: T) => { revalidatePath("/buy/food-safety", "layout"); return v; };
const ok = { ok: true } as const;
const LOG = ["buyer.haccp.log", "buyer.haccp.manage"] as const;

export const saveHaccpUnitAction = defineAction({ permission: "buyer.haccp.manage", schema: z.object({ id: id.nullable(), input: z.unknown() }), handler: async (ctx, i) => buy({ id: (await (await svc()).saveUnit(ctx, i.id, firstIssue(unitSchema, i.input))).id }) });
export const saveHaccpTaskAction = defineAction({ permission: "buyer.haccp.manage", schema: z.object({ id: id.nullable(), input: z.unknown() }), handler: async (ctx, i) => buy({ id: (await (await svc()).saveTask(ctx, i.id, firstIssue(taskSchema, i.input))).id }) });
export const applyHaccpTemplateAction = defineAction({
  permission: "buyer.haccp.manage", schema: z.object({ key: z.string().max(20) }),
  handler: async (ctx, i) => {
    const { haccpLabels } = await import("@/components/haccp/labels");
    const { l } = await haccpLabels();
    return buy({ made: await (await svc()).applyTemplate(ctx, i.key, (k) => l[k] ?? k) });
  },
});
export const logHaccpTempAction = defineAction({ permission: [...LOG], schema: z.unknown(), handler: async (ctx, i) => buy({ ok: (await (await svc()).logTemp(ctx, firstIssue(tempSchema, i))).ok }) });
export const logHaccpDeliveryAction = defineAction({ permission: [...LOG], schema: z.unknown(), handler: async (ctx, i) => { const r = await (await svc()).logDelivery(ctx, firstIssue(deliverySchema, i)); return buy({ ok: r.entry.ok, claimUrl: r.claimUrl }); } });
export const logHaccpCoolingAction = defineAction({ permission: [...LOG], schema: z.unknown(), handler: async (ctx, i) => buy({ ok: (await (await svc()).logCooling(ctx, firstIssue(coolingSchema, i))).ok }) });
export const deleteHaccpEntryAction = defineAction({ permission: [...LOG], schema: z.object({ id }), handler: async (ctx, i) => { await (await svc()).deleteEntry(ctx, i.id); return buy(ok); } });
/** A checklist / cleaning done — FormData (an optional photo). */
export async function logHaccpTaskAction(fd: FormData) {
  return runAction(async (ctx) => {
    const { can } = await import("@/server/rbac/guard");
    if (!can(ctx, [...LOG])) throw new (await import("@/server/errors")).ForbiddenError();
    const taskId = String(fd.get("taskId") ?? "");
    if (!taskId) throw new ValidationError("Checklist missing.");
    let results: Record<string, boolean> = {};
    try { results = JSON.parse(String(fd.get("results") ?? "{}")); } catch { throw new ValidationError("Tick the items."); }
    const photo = fd.get("photo");
    const r = await (await svc()).logTask(ctx, { taskId, results, note: String(fd.get("note") ?? "") || null, corrective: String(fd.get("corrective") ?? "") || null, photo: photo instanceof File && photo.size > 0 ? photo : null });
    return buy({ ok: r.ok });
  });
}
export const saveHaccpTrainingAction = defineAction({ permission: "buyer.haccp.manage", schema: z.object({ id: id.nullable(), input: z.unknown() }), handler: async (ctx, i) => buy({ id: (await (await svc()).saveTraining(ctx, i.id, firstIssue(trainingSchema, i.input))).id }) });
export const deleteHaccpTrainingAction = defineAction({ permission: "buyer.haccp.manage", schema: z.object({ id }), handler: async (ctx, i) => { await (await svc()).deleteTraining(ctx, i.id); return buy(ok); } });

// ── FIRINGI ──
export const saveHaccpSettingsAction = defineAction({
  permission: ["admin.haccp.manage", "admin.settings.manage"], schema: settingsSchema,
  handler: async (ctx, i) => { await (await import("@/server/haccp/settings")).saveHaccpSettings(ctx, i); revalidatePath("/admin/food-safety"); return ok; },
});
export const setCompanyHaccpAction = defineAction({
  permission: ["admin.haccp.manage", "admin.settings.manage"], schema: z.object({ companyId: id, value: z.enum(["ON", "OFF"]).nullable() }),
  handler: async (ctx, i) => { await (await import("@/server/haccp/settings")).setCompanyHaccp(ctx, i.companyId, i.value); revalidatePath("/admin/food-safety"); return ok; },
});
