"use server";
/** Phase 13 actions: CRM (FIRINGI staff) and support tickets (companies and staff). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as crm from "@/server/services/crm";
import { deleteSegment, saveSegment } from "@/server/services/crm-insights";
import { openTicket, replyTicket, updateTicket } from "@/server/services/support";

const done = <T>(v: T) => { revalidatePath("/admin/crm", "layout"); revalidatePath("/admin/customers", "layout"); return v; };
const VIEW = ["admin.crm.view", "admin.crm.manage"] as const;
const M = "admin.crm.manage" as const;
const id = z.string().min(1);
const optId = z.string().min(1).nullable().optional();
const s = (max = 200) => z.string().trim().max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).transform((v) => new Date(v.length === 10 ? `${v}T09:00:00` : v));
const KINDS = ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"] as const;
const SOURCES = ["WEBSITE", "REFERRAL", "FIELD_VISIT", "PHONE", "EVENT", "SOCIAL", "OTHER"] as const;
const STAGES = ["PROSPECTING", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
const ACT = ["CALL", "EMAIL", "WHATSAPP", "MEETING", "VISIT", "NOTE"] as const;

const leadSchema = z.object({
  companyName: s(), contactName: s().nullable().optional(), email: s().nullable().optional(), phone: s(40).nullable().optional(), countryCode: z.string().length(2),
  city: s(80).nullable().optional(), kind: z.enum(KINDS), source: z.enum(SOURCES).optional(), ownerId: optId, estimatedMonthlyNet: z.coerce.number().min(0).nullable().optional(), notes: s(2000).nullable().optional(),
});
export const createLeadAction = defineAction({ permission: M, schema: leadSchema, handler: async (ctx, i) => done({ id: (await crm.createLead(ctx, i)).id }) });
export const updateLeadAction = defineAction({
  permission: M,
  schema: leadSchema.partial().extend({ id, status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "LOST"]).optional(), lostReason: s(500).nullable().optional() }),
  handler: async (ctx, { id: leadId, ...rest }) => done((await crm.updateLead(ctx, leadId, rest)).id),
});
export const convertLeadAction = defineAction({ permission: M, schema: z.object({ leadId: id, companyId: id }), handler: async (ctx, i) => done(await crm.convertLead(ctx, i.leadId, i.companyId)) });

export const setAccountAction = defineAction({
  permission: M,
  schema: z.object({ companyId: id, ownerId: optId, tier: z.enum(["A", "B", "C"]).nullable().optional(), tags: z.array(s(40)).max(20).optional() }),
  handler: async (ctx, { companyId, ...rest }) => done((await crm.setAccount(ctx, companyId, rest)).companyId),
});

export const saveContactAction = defineAction({
  permission: M,
  schema: z.object({ id: optId, companyId: optId, leadId: optId, name: s(120), jobTitle: s(80).nullable().optional(), email: s().nullable().optional(), phone: s(40).nullable().optional(), isPrimary: z.boolean().optional(), notes: s(1000).nullable().optional() }),
  handler: async (ctx, { id: cid, ...rest }) => done((await crm.saveContact(ctx, cid ?? null, rest)).id),
});
export const deleteContactAction = defineAction({ permission: M, schema: z.object({ id }), handler: async (ctx, i) => done(await crm.deleteContact(ctx, i.id)) });

export const createDealAction = defineAction({
  permission: M,
  schema: z.object({ title: s(), companyId: optId, leadId: optId, valueNet: z.coerce.number().min(0), expectedCloseAt: day.nullable().optional(), ownerId: optId, stage: z.enum(STAGES).optional() }),
  handler: async (ctx, i) => done({ id: (await crm.createDeal(ctx, i)).id }),
});
export const moveDealAction = defineAction({
  permission: M,
  schema: z.object({ id, stage: z.enum(STAGES), lostReason: s(500).nullable().optional() }),
  handler: async (ctx, i) => done((await crm.moveDeal(ctx, i.id, i.stage, i.lostReason)).id),
});

export const logActivityAction = defineAction({
  permission: M,
  schema: z.object({ kind: z.enum(ACT), subject: s(300), body: s(5000).nullable().optional(), at: day.nullable().optional(), outbound: z.boolean().optional(), companyId: optId, leadId: optId, dealId: optId }),
  handler: async (ctx, i) => done((await crm.logActivity(ctx, i)).id),
});

export const createTaskAction = defineAction({
  permission: M,
  schema: z.object({ kind: z.enum(["FOLLOW_UP", "TASK"]).optional(), title: s(300), notes: s(2000).nullable().optional(), dueAt: day, assigneeId: optId, companyId: optId, leadId: optId, dealId: optId }),
  handler: async (ctx, i) => done((await crm.createTask(ctx, i)).id),
});
export const setTaskStatusAction = defineAction({
  permission: [...VIEW],
  schema: z.object({ id, status: z.enum(["DONE", "CANCELLED", "OPEN"]) }),
  handler: async (ctx, i) => done((await crm.setTaskStatus(ctx, i.id, i.status)).id),
});

export const saveSegmentAction = defineAction({
  permission: M,
  schema: z.object({ id: optId, name: s(80), description: s(300).nullable().optional(), rules: z.record(z.string(), z.unknown()) }),
  handler: async (ctx, i) => done({ id: (await saveSegment(ctx, i.id ?? null, i)).id }),
});
export const deleteSegmentAction = defineAction({ permission: M, schema: z.object({ id }), handler: async (ctx, i) => done(await deleteSegment(ctx, i.id)) });

// ── support ─────────────────────────────────────────────────────────────────

export const openTicketAction = defineAction({
  permission: "company.support.use",
  schema: z.object({ subject: s(150), body: s(5000), category: z.enum(["ORDER", "DELIVERY", "INVOICE", "PAYMENT", "PRODUCT", "ACCOUNT", "OTHER"]), orderId: optId }),
  handler: async (ctx, i) => {
    const t = await openTicket(ctx, i);
    revalidatePath("/buy/support"); revalidatePath("/vendor/support");
    return { id: t.id, number: t.number };
  },
});
export const replyTicketAction = defineAction({
  permission: null, // company members (company.support.use) and FIRINGI staff — checked in the service
  schema: z.object({ id, body: s(5000), internal: z.boolean().optional(), resolve: z.boolean().optional() }),
  handler: async (ctx, i) => { await replyTicket(ctx, i.id, i); return i.id; },
});
export const updateTicketAction = defineAction({
  permission: "admin.support.manage",
  schema: z.object({ id, assigneeId: optId, priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), status: z.enum(["OPEN", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"]).optional() }),
  handler: async (ctx, { id: tid, ...rest }) => done((await updateTicket(ctx, tid, rest)).id),
});
