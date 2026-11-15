/**
 * Support requests ("tickets") from customers and suppliers to FIRINGI.
 *   • A company member (company.support.use) opens a ticket — optionally about one of its
 *     orders — and follows the conversation; FIRINGI's internal notes are never shown.
 *   • FIRINGI staff (admin.support.manage) answer, add internal notes, assign, set priority
 *     and status. Status follows the conversation: a staff answer → waiting for the company,
 *     the company's answer → open again.
 */
import type { Prisma, TicketCategory, TicketPriority, TicketStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { scopeWhere } from "./admin-access";
import { nextNumber } from "./orders";
import { writeAudit } from "./audit";
import { notify } from "@/server/notify/dispatch";

const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ["admin.support.manage", "admin.crm.view", "admin.customers.view"]);
const canAnswer = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.support.manage");
const isMember = (ctx: Ctx) => ctx.company.type !== "ADMIN" && can(ctx, "company.support.use");
const portalOf = (type: string) => (type === "CUSTOMER" ? "/buy" : "/vendor");
const firingiId = async () => (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id;

export const CATEGORIES: TicketCategory[] = ["ORDER", "DELIVERY", "INVOICE", "PAYMENT", "PRODUCT", "ACCOUNT", "OTHER"];

export async function openTicket(ctx: Ctx, i: { subject: string; body: string; category: TicketCategory; orderId?: string | null; photoKeys?: string[] }) {
  if (!isMember(ctx)) throw new ForbiddenError();
  const subject = i.subject.trim(), body = i.body.trim();
  if (subject.length < 3) throw new ValidationError("Write a short subject.");
  if (body.length < 5) throw new ValidationError("Describe how we can help.");
  if (i.orderId) {
    const o = await prisma.order.findFirst({ where: { id: i.orderId, OR: [{ buyerCompanyId: ctx.company.id }, { sellerCompanyId: ctx.company.id }] } });
    if (!o) throw new ValidationError("Choose one of your orders.");
  }
  const t = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "ticket", "TK");
    const t = await tx.supportTicket.create({
      data: {
        number, companyId: ctx.company.id, openedById: ctx.user.id, subject, category: i.category, orderId: i.orderId ?? null,
        priority: i.category === "DELIVERY" || i.category === "ORDER" ? "HIGH" : "NORMAL",
        messages: { create: { authorId: ctx.user.id, body, photoKeys: (i.photoKeys ?? []).slice(0, 6) } },
      },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "support.opened", entityType: "SupportTicket", entityId: t.id, after: { number, subject, category: i.category } }, tx);
    return t;
  });
  await notify("support.new", [{ companyId: await firingiId(), link: `/admin/customers/support/${t.id}` }], { number: t.number, company: ctx.company.tradeName ?? ctx.company.legalName, subject }, { ref: { type: "SupportTicket", id: t.id } });
  return t;
}

const ticketInclude = {
  company: { select: { id: true, legalName: true, tradeName: true, type: true, phone: true, email: true } },
  openedBy: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true } },
  order: { select: { id: true, number: true, status: true } },
  messages: { orderBy: { createdAt: "asc" as const }, include: { author: { select: { name: true } } } },
} satisfies Prisma.SupportTicketInclude;

export async function ticketDetail(ctx: Ctx, id: string) {
  const t = await prisma.supportTicket.findUnique({ where: { id }, include: ticketInclude });
  if (!t) throw new NotFoundError("Ticket");
  if (isStaff(ctx)) {
    if (ctx.scopes.length && !(await prisma.company.count({ where: { id: t.companyId, ...scopeWhere(ctx) } }))) throw new NotFoundError("Ticket");
    return { ticket: t, staff: true, canAnswer: canAnswer(ctx) };
  }
  if (!isMember(ctx) || t.companyId !== ctx.company.id) throw new NotFoundError("Ticket");
  return { ticket: { ...t, messages: t.messages.filter((m) => !m.internal) }, staff: false, canAnswer: false };
}

/** A photo on a ticket message (same access as the ticket; internal notes stay with FIRINGI). */
export async function ticketPhotoKey(ctx: Ctx, ticketId: string, messageId: string, n: number) {
  const { ticket } = await ticketDetail(ctx, ticketId);
  const key = ticket.messages.find((m) => m.id === messageId)?.photoKeys[n];
  if (!key) throw new NotFoundError("Photo");
  return key;
}

/** A message on a ticket: from the company, or from FIRINGI (answer or internal note). */
export async function replyTicket(ctx: Ctx, id: string, i: { body: string; internal?: boolean; resolve?: boolean }) {
  const { ticket: t, staff } = await ticketDetail(ctx, id);
  const body = i.body.trim();
  if (body.length < 2) throw new ValidationError("Write a message.");
  if (staff && !canAnswer(ctx)) throw new ForbiddenError();
  const internal = staff && !!i.internal;
  let status: TicketStatus = t.status;
  if (!internal) status = staff ? (i.resolve ? "RESOLVED" : "PENDING_CUSTOMER") : "OPEN"; // a company message reopens a resolved / closed ticket
  await prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({ data: { ticketId: id, authorId: ctx.user.id, body, internal, fromStaff: staff } });
    await tx.supportTicket.update({
      where: { id },
      data: { status, lastMessageAt: new Date(), resolvedAt: status === "RESOLVED" ? new Date() : status === "OPEN" ? null : t.resolvedAt, ...(staff && !t.assigneeId ? { assigneeId: ctx.user.id } : {}) },
    });
  });
  if (internal) return;
  if (staff) {
    await notify(status === "RESOLVED" ? "support.resolved" : "support.reply", [{ userId: t.openedBy.id, link: `${portalOf(t.company.type)}/support/${id}` }], { number: t.number, subject: t.subject }, { ref: { type: "SupportTicket", id } });
  } else {
    const target = t.assignee ? { userId: t.assignee.id } : { companyId: await firingiId() };
    await notify("support.message", [{ ...target, link: `/admin/customers/support/${id}` }], { number: t.number, company: t.company.tradeName ?? t.company.legalName }, { ref: { type: "SupportTicket", id } });
  }
}

/** Staff: assign, priority, status. */
export async function updateTicket(ctx: Ctx, id: string, i: { assigneeId?: string | null; priority?: TicketPriority; status?: TicketStatus }) {
  if (!canAnswer(ctx)) throw new ForbiddenError();
  const { ticket: t } = await ticketDetail(ctx, id);
  if (i.assigneeId && !(await prisma.membership.count({ where: { companyId: ctx.company.id, userId: i.assigneeId, status: "ACTIVE" } }))) throw new ValidationError("Choose someone from FIRINGI's team.");
  const u = await prisma.supportTicket.update({
    where: { id },
    data: {
      ...(i.assigneeId !== undefined ? { assigneeId: i.assigneeId } : {}), ...(i.priority ? { priority: i.priority } : {}),
      ...(i.status ? { status: i.status, resolvedAt: i.status === "RESOLVED" || i.status === "CLOSED" ? t.resolvedAt ?? new Date() : null } : {}),
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "support.updated", entityType: "SupportTicket", entityId: id, before: { assigneeId: t.assignee?.id ?? null, priority: t.priority, status: t.status }, after: i });
  if (i.assigneeId && i.assigneeId !== t.assignee?.id && i.assigneeId !== ctx.user.id)
    await notify("support.message", [{ userId: i.assigneeId, link: `/admin/customers/support/${id}` }], { number: t.number, company: t.company.tradeName ?? t.company.legalName }, { ref: { type: "SupportTicket", id } });
  if (i.status === "RESOLVED" && t.status !== "RESOLVED")
    await notify("support.resolved", [{ userId: t.openedBy.id, link: `${portalOf(t.company.type)}/support/${id}` }], { number: t.number, subject: t.subject }, { ref: { type: "SupportTicket", id } });
  return u;
}

export async function listTickets(ctx: Ctx, f: { status?: TicketStatus | "ACTIVE"; assigneeId?: string | "none"; companyId?: string; q?: string } = {}) {
  const staff = isStaff(ctx);
  if (!staff && !isMember(ctx)) throw new ForbiddenError();
  const where: Prisma.SupportTicketWhereInput = {
    ...(staff ? { company: scopeWhere(ctx), ...(f.companyId ? { companyId: f.companyId } : {}) } : { companyId: ctx.company.id }),
    ...(f.status === "ACTIVE" ? { status: { in: ["OPEN", "PENDING_CUSTOMER"] } } : f.status ? { status: f.status } : {}),
    ...(staff && f.assigneeId ? { assigneeId: f.assigneeId === "none" ? null : f.assigneeId } : {}),
    ...(f.q ? { OR: [{ number: { contains: f.q, mode: "insensitive" } }, { subject: { contains: f.q, mode: "insensitive" } }, ...(staff ? [{ company: { legalName: { contains: f.q, mode: "insensitive" as const } } }] : [])] } : {}),
  };
  return prisma.supportTicket.findMany({
    where, take: 300,
    orderBy: staff ? [{ status: "asc" }, { priority: "desc" }, { lastMessageAt: "asc" }] : [{ lastMessageAt: "desc" }],
    include: { company: { select: { id: true, legalName: true, type: true } }, assignee: { select: { name: true } }, order: { select: { id: true, number: true } }, _count: { select: { messages: { where: staff ? {} : { internal: false } } } } },
  });
}

/** Counts for the staff queue tiles. */
export async function ticketCounts(ctx: Ctx) {
  if (!isStaff(ctx)) throw new ForbiddenError();
  const rows = await prisma.supportTicket.groupBy({ by: ["status"], where: { company: scopeWhere(ctx) }, _count: true });
  const unassigned = await prisma.supportTicket.count({ where: { company: scopeWhere(ctx), status: "OPEN", assigneeId: null } });
  return { ...Object.fromEntries(rows.map((r) => [r.status, r._count])), unassigned } as Partial<Record<TicketStatus, number>> & { unassigned: number };
}

/** The company's recent orders for the "about an order" picker. */
export async function ticketOrderOptions(ctx: Ctx) {
  if (!isMember(ctx)) throw new ForbiddenError();
  return prisma.order.findMany({ where: { OR: [{ buyerCompanyId: ctx.company.id }, { sellerCompanyId: ctx.company.id }] }, orderBy: { placedAt: "desc" }, take: 30, select: { id: true, number: true, placedAt: true } });
}
