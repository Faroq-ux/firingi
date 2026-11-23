import "server-only";
/**
 * Phase 67: tools only AI agents get, next to the staff assistant's read-only tools (tools.ts):
 * overdue customers, finding a company, and the two actions — a CRM follow-up task and a message to a
 * staff group. Actions never run straight from Claude: they go through `agentAct` (approval queue, or
 * straight away only when the agent may act on its own AND AI Governance allows that action).
 */
import { z } from "zod";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { STAFF_GROUPS, type StaffGroup } from "@/lib/ai-ops";

export type AgentTool = {
  name: string; description: string; properties: Record<string, unknown>; input: z.ZodType<unknown>;
  act?: boolean;
  run: (ctx: Ctx, input: never) => Promise<unknown>;
};
const lim = z.number().int().transform((n) => Math.max(1, Math.min(50, n)));
const GROUPS = Object.keys(STAFF_GROUPS) as [StaffGroup, ...StaffGroup[]];

export const AGENT_ONLY_TOOLS: AgentTool[] = [
  {
    name: "overdue_customers",
    description: "Customers with overdue invoices (unpaid after the due date), most money first: customer id and name, overdue amount in EUR incl. VAT, number of invoices, oldest due date and days late.",
    properties: { min_days_late: { type: "integer", description: "Only invoices at least this many days late (0 = all overdue)" }, limit: { type: "integer", description: "1–50" } },
    input: z.object({ min_days_late: z.number().int().transform((n) => Math.max(0, Math.min(365, n))), limit: lim }),
    run: async (ctx, i: { min_days_late: number; limit: number }) => {
      if (!can(ctx, ["admin.finance.view", "admin.finance.manage", "admin.invoices.view"])) throw new ForbiddenError();
      const { overdueByCustomer } = await import("../centre/recs");
      return (await overdueByCustomer(new Date(), i.min_days_late)).sort((a, b) => b.open - a.open).slice(0, i.limit);
    },
  },
  {
    name: "find_company",
    description: "Find customers / suppliers by name (part of the legal or trade name). Returns id, name, type, country and status — use the id for create_task.",
    properties: { query: { type: "string", description: "Part of the name" }, type: { type: "string", enum: ["ANY", "CUSTOMER", "WHOLESALER", "DISTRIBUTOR"] } },
    input: z.object({ query: z.string().min(2).max(80), type: z.enum(["ANY", "CUSTOMER", "WHOLESALER", "DISTRIBUTOR"]) }),
    run: async (ctx, i: { query: string; type: string }) => {
      if (!can(ctx, ["admin.customers.view", "admin.vendors.view", "admin.crm.view"])) throw new ForbiddenError();
      const rows = await prisma.company.findMany({
        where: { type: i.type === "ANY" ? { not: "ADMIN" } : (i.type as "CUSTOMER"), OR: [{ legalName: { contains: i.query, mode: "insensitive" } }, { tradeName: { contains: i.query, mode: "insensitive" } }] },
        take: 10, select: { id: true, legalName: true, tradeName: true, type: true, status: true, country: { select: { code: true } } },
      });
      return rows.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, country: c.country.code, status: c.status }));
    },
  },
  {
    name: "create_task",
    act: true,
    description: "Propose a CRM follow-up task for FIRINGI staff about one company (call a customer, chase a payment, review a supplier). It goes to the company's account manager. Give the company id (from overdue_customers, find_company or another tool), a short title, notes with the facts, and why you propose it.",
    properties: { company_id: { type: "string" }, title: { type: "string", description: "What to do, e.g. 'Call Kebab House about €1,840 overdue'" }, notes: { type: "string", description: "The facts and what to say" }, due_in_days: { type: "integer", description: "0–30" }, why: { type: "string", description: "One sentence: why this is worth doing" } },
    input: z.object({ company_id: z.string().min(5).max(40), title: z.string().min(3).max(150), notes: z.string().max(2000), due_in_days: z.number().int().transform((n) => Math.max(0, Math.min(30, n))), why: z.string().max(500) }),
    run: async (ctx, i: { company_id: string; title: string; notes: string; due_in_days: number }) => {
      const c = await prisma.company.findUnique({ where: { id: i.company_id }, select: { id: true } });
      if (!c) throw new NotFoundError("Company");
      if (!can(ctx, "admin.crm.manage")) throw new ForbiddenError("Creating CRM tasks needs the CRM (manage) right.");
      const { createTask } = await import("@/server/services/crm");
      const owner = (await prisma.crmAccount.findUnique({ where: { companyId: c.id }, select: { ownerId: true } }))?.ownerId;
      const t = await createTask(ctx, { kind: "FOLLOW_UP", companyId: c.id, assigneeId: owner ?? ctx.user.id, dueAt: new Date(Date.now() + i.due_in_days * 86400_000), title: i.title, notes: i.notes });
      return { taskId: t.id, title: t.title };
    },
  },
  {
    name: "notify_staff",
    act: true,
    description: "Send a short message to a group of FIRINGI staff (in the app, and by email / push as each person chose). Use for something a team must know today.",
    properties: { group: { type: "string", enum: GROUPS, description: Object.entries(STAFF_GROUPS).map(([k, v]) => `${k} = ${v}`).join("; ") }, title: { type: "string" }, body: { type: "string" }, why: { type: "string" } },
    input: z.object({ group: z.enum(GROUPS), title: z.string().min(3).max(150), body: z.string().min(3).max(1500), why: z.string().max(500) }),
    run: async (_ctx, i: { group: StaffGroup; title: string; body: string }) => {
      if (!STAFF_GROUPS[i.group]) throw new ValidationError("Unknown staff group.");
      const { notifyStaffGroup } = await import("./notify");
      return { recipients: await notifyStaffGroup(i.group, i.title, i.body, "/admin/ai/agents") };
    },
  },
];
