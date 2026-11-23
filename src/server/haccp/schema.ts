/** Input shapes for the food safety actions (Phase 69) — kept out of the "use server" file. */
import { z } from "zod";
import { TASK_FREQUENCIES, TASK_KINDS, UNIT_KINDS } from "@/lib/haccp";

export const id = z.string().min(1).max(40);
const temp = z.coerce.number().min(-60).max(150);
const optTemp = z.union([z.literal(""), z.null(), z.undefined(), temp]).transform((v) => (v === "" || v == null ? null : Number(v)));
const text = (n: number) => z.string().trim().max(n).nullable().optional();

export const unitSchema = z.object({ name: z.string().trim().min(1, "Name the equipment.").max(60), kind: z.enum(UNIT_KINDS), minC: optTemp, maxC: optTemp, times: z.array(z.string()).max(6), active: z.boolean().optional() });
export const taskSchema = z.object({
  name: z.string().trim().min(1, "Name the checklist.").max(80), kind: z.enum(TASK_KINDS), frequency: z.enum(TASK_FREQUENCIES), weekday: z.coerce.number().int().min(1).max(7).nullable().optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().optional(), items: z.array(z.string().max(120)).min(1, "Add at least one item to check.").max(30), needsPhoto: z.boolean().optional(), active: z.boolean().optional(),
});
export const tempSchema = z.object({ unitId: id, slot: z.string().max(5).nullable().optional(), valueC: temp, note: text(300), corrective: text(500) });
export const deliverySchema = z.object({ orderId: id.nullable().optional(), supplier: text(80), product: text(120), valueC: optTemp, frozen: z.boolean().optional(), packagingOk: z.boolean(), datesOk: z.boolean(), note: text(300), corrective: text(500) });
export const coolingSchema = z.object({ product: z.string().trim().min(1, "Write what was cooled.").max(120), startC: temp, endC: temp, minutes: z.coerce.number().int().min(1).max(1439), note: text(300), corrective: text(500) });
export const trainingSchema = z.object({ personName: z.string().trim().min(1, "Write the person.").max(80), course: z.string().trim().min(1, "Write the course.").max(120), certificateNo: text(60), issuedAt: z.coerce.date(), expiresAt: z.coerce.date().nullable().optional(), note: text(300) });
export const settingsSchema = z.object({
  enabled: z.boolean(), audiences: z.object({ customers: z.boolean(), wholesalers: z.boolean() }),
  parts: z.object({ temperatures: z.boolean(), checklists: z.boolean(), cleaning: z.boolean(), deliveries: z.boolean(), cooling: z.boolean(), training: z.boolean(), photos: z.boolean(), reports: z.boolean(), reminders: z.boolean(), ai: z.boolean() }),
  templates: z.record(z.string(), z.boolean()),
  rules: z.object({ coolingTargetC: z.coerce.number(), coolingMaxMinutes: z.coerce.number(), graceMinutes: z.coerce.number(), trainingWarnDays: z.coerce.number(), deliveryChilledMaxC: z.coerce.number(), deliveryFrozenMaxC: z.coerce.number() }),
});
