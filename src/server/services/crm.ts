/**
 * CRM & Sales (FIRINGI back office):
 *   • Leads — businesses FIRINGI wants on the platform. A lead converts when its company
 *     registers (matched by e-mail / VAT number on approval) or is linked by hand.
 *   • Business accounts — approved companies with an account manager, tier and tags.
 *   • Contacts, deals (pipeline), activities (calls, e-mails, WhatsApp, meetings, visits,
 *     notes = the communications history) and tasks / follow-ups.
 * Viewing needs admin.crm.view; changing needs admin.crm.manage. Regional managers only
 * see companies in their scope.
 */
import { Prisma, type CompanyType, type CrmActivityKind, type CrmTaskKind, type DealStage, type LeadSource, type LeadStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { scopeWhere } from "./admin-access";
import { nextNumber } from "./orders";
import { writeAudit } from "./audit";
import { notify } from "@/server/notify/dispatch";

export function assertCrmView(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.crm.view", "admin.crm.manage"])) throw new ForbiddenError();
}
export function assertCrmManage(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.crm.manage")) throw new ForbiddenError();
}
/** Records about a company in the user's regional scope, or about no company (leads). Empty for unscoped staff. */
const inScope = (ctx: Ctx) => (ctx.scopes.length ? { OR: [{ company: scopeWhere(ctx) }, { companyId: null }] } : {});
const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);
const PARTNER_TYPES: CompanyType[] = ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"];

/** FIRINGI staff who can own leads / accounts / deals and take tasks. */
export async function crmTeam(ctx: Ctx) {
  assertCrmView(ctx);
  const m = await prisma.membership.findMany({ where: { companyId: ctx.company.id, status: "ACTIVE" }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: "asc" } } });
  return m.map((x) => x.user);
}
async function assertStaff(ctx: Ctx, userId: string | null | undefined) {
  if (!userId) return;
  const ok = await prisma.membership.count({ where: { companyId: ctx.company.id, userId, status: "ACTIVE" } });
  if (!ok) throw new ValidationError("Choose someone from FIRINGI's team.");
}
async function assertCompanyInScope(ctx: Ctx, companyId: string | null | undefined) {
  if (!companyId) return;
  const ok = await prisma.company.count({ where: { id: companyId, type: { in: PARTNER_TYPES }, ...scopeWhere(ctx) } });
  if (!ok) throw new NotFoundError("Company");
}

// ── leads ───────────────────────────────────────────────────────────────────

export type LeadInput = {
  companyName: string; contactName?: string | null; email?: string | null; phone?: string | null; countryCode: string; city?: string | null;
  kind: "CUSTOMER" | "WHOLESALER" | "DISTRIBUTOR"; source?: LeadSource; ownerId?: string | null; estimatedMonthlyNet?: number | null; notes?: string | null;
};

export async function listLeads(ctx: Ctx, f: { status?: LeadStatus | "OPEN"; ownerId?: string; q?: string } = {}) {
  assertCrmView(ctx);
  const where: Prisma.LeadWhereInput = {
    ...(f.status === "OPEN" ? { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } } : f.status ? { status: f.status } : {}),
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.q ? { OR: [{ companyName: { contains: f.q, mode: "insensitive" } }, { contactName: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }, { number: { contains: f.q, mode: "insensitive" } }] } : {}),
    ...(ctx.scopes.length ? { countryId: { in: ctx.scopes.map((s) => s.countryId).filter(Boolean) as string[] } } : {}),
  };
  return prisma.lead.findMany({
    where, orderBy: [{ updatedAt: "desc" }], take: 300,
    include: { country: { select: { code: true, flag: true } }, owner: { select: { name: true } }, convertedCompany: { select: { id: true, legalName: true } }, _count: { select: { activities: true } }, tasks: { where: { status: "OPEN" }, select: { dueAt: true }, orderBy: { dueAt: "asc" }, take: 1 } },
  });
}

export async function createLead(ctx: Ctx, i: LeadInput) {
  assertCrmManage(ctx);
  if (!i.companyName.trim()) throw new ValidationError("Enter the business name.");
  if (!clean(i.email) && !clean(i.phone)) throw new ValidationError("Enter an e-mail or a phone number.");
  const country = await prisma.country.findUnique({ where: { code: i.countryCode } });
  if (!country) throw new ValidationError("Choose a country.");
  await assertStaff(ctx, i.ownerId);
  const lead = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "lead", "LD");
    const l = await tx.lead.create({
      data: {
        number, companyName: i.companyName.trim(), contactName: clean(i.contactName), email: clean(i.email)?.toLowerCase() ?? null, phone: clean(i.phone), countryId: country.id,
        city: clean(i.city), kind: i.kind, source: i.source ?? "OTHER", ownerId: i.ownerId ?? ctx.user.id, estimatedMonthlyNet: i.estimatedMonthlyNet ?? null, notes: clean(i.notes), createdById: ctx.user.id,
      },
    });
    if (clean(i.contactName)) await tx.crmContact.create({ data: { leadId: l.id, name: clean(i.contactName)!, email: l.email, phone: l.phone, isPrimary: true } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "crm.lead_created", entityType: "Lead", entityId: l.id, after: { number, companyName: l.companyName } }, tx);
    return l;
  });
  if (lead.ownerId && lead.ownerId !== ctx.user.id) await notifyAssigned("Lead", lead.ownerId, `${lead.number} · ${lead.companyName}`, `/admin/crm/leads/${lead.id}`);
  return lead;
}

export async function updateLead(ctx: Ctx, id: string, i: Partial<LeadInput> & { status?: LeadStatus; lostReason?: string | null }) {
  assertCrmManage(ctx);
  const cur = await prisma.lead.findUnique({ where: { id } });
  if (!cur) throw new NotFoundError("Lead");
  if (i.status === "CONVERTED") throw new ValidationError("A lead converts when its company is linked (Convert).");
  if (i.status === "LOST" && !clean(i.lostReason ?? cur.lostReason)) throw new ValidationError("Say why the lead was lost.");
  if (cur.status === "CONVERTED" && i.status) throw new ValidationError("This lead is already a customer.");
  await assertStaff(ctx, i.ownerId);
  const country = i.countryCode ? await prisma.country.findUnique({ where: { code: i.countryCode } }) : null;
  const l = await prisma.lead.update({
    where: { id },
    data: {
      ...(i.companyName !== undefined ? { companyName: i.companyName.trim() } : {}),
      ...(i.contactName !== undefined ? { contactName: clean(i.contactName) } : {}),
      ...(i.email !== undefined ? { email: clean(i.email)?.toLowerCase() ?? null } : {}),
      ...(i.phone !== undefined ? { phone: clean(i.phone) } : {}),
      ...(country ? { countryId: country.id } : {}),
      ...(i.city !== undefined ? { city: clean(i.city) } : {}),
      ...(i.kind ? { kind: i.kind } : {}),
      ...(i.source ? { source: i.source } : {}),
      ...(i.ownerId !== undefined ? { ownerId: i.ownerId } : {}),
      ...(i.estimatedMonthlyNet !== undefined ? { estimatedMonthlyNet: i.estimatedMonthlyNet } : {}),
      ...(i.notes !== undefined ? { notes: clean(i.notes) } : {}),
      ...(i.status ? { status: i.status, lostReason: i.status === "LOST" ? clean(i.lostReason ?? cur.lostReason) : null } : {}),
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "crm.lead_updated", entityType: "Lead", entityId: id, before: { status: cur.status, ownerId: cur.ownerId }, after: { status: l.status, ownerId: l.ownerId } });
  if (i.ownerId && i.ownerId !== cur.ownerId && i.ownerId !== ctx.user.id) await notifyAssigned("Lead", i.ownerId, `${l.number} · ${l.companyName}`, `/admin/crm/leads/${l.id}`);
  return l;
}

/** Link a lead to the company it became: lead → CONVERTED; its contacts, activities and open deals move to the account. */
export async function convertLead(ctx: Ctx, leadId: string, companyId: string) {
  assertCrmManage(ctx);
  await assertCompanyInScope(ctx, companyId);
  await prisma.$transaction((tx) => linkLead(tx, leadId, companyId, ctx.user.id));
}

async function linkLead(tx: Prisma.TransactionClient, leadId: string, companyId: string, userId: string | null) {
  const lead = await tx.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.status === "CONVERTED") return;
  await tx.lead.update({ where: { id: leadId }, data: { status: "CONVERTED", convertedCompanyId: companyId, convertedAt: new Date() } });
  await tx.crmContact.updateMany({ where: { leadId }, data: { companyId } });
  await tx.crmActivity.updateMany({ where: { leadId, companyId: null }, data: { companyId } });
  await tx.crmTask.updateMany({ where: { leadId, companyId: null }, data: { companyId } });
  await tx.deal.updateMany({ where: { leadId, companyId: null }, data: { companyId } });
  // The lead's owner becomes the account manager (unless the account has one).
  const acc = await tx.crmAccount.findUnique({ where: { companyId } });
  if (!acc) await tx.crmAccount.create({ data: { companyId, ownerId: lead.ownerId } });
  else if (!acc.ownerId && lead.ownerId) await tx.crmAccount.update({ where: { companyId }, data: { ownerId: lead.ownerId } });
  await writeAudit({ actorUserId: userId, actorCompanyId: null, action: "crm.lead_converted", entityType: "Lead", entityId: leadId, after: { companyId } }, tx);
}

/** On approval: an open lead with the company's (or its owner's) e-mail converts automatically. */
export async function convertMatchingLeads(companyId: string) {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { email: true, memberships: { where: { isOwner: true }, select: { user: { select: { email: true } } } } } });
  if (!c) return 0;
  const emails = [c.email, ...c.memberships.map((m) => m.user.email)].filter(Boolean).map((e) => e!.toLowerCase());
  if (!emails.length) return 0;
  const leads = await prisma.lead.findMany({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] }, email: { in: emails } }, select: { id: true } });
  for (const l of leads) await prisma.$transaction((tx) => linkLead(tx, l.id, companyId, null));
  return leads.length;
}

export async function leadDetail(ctx: Ctx, id: string) {
  assertCrmView(ctx);
  const l = await prisma.lead.findUnique({
    where: { id },
    include: {
      country: true, owner: { select: { id: true, name: true } }, convertedCompany: { select: { id: true, legalName: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      deals: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { at: "desc" }, include: { by: { select: { name: true } } } },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }], include: { assignee: { select: { name: true } } } },
    },
  });
  if (!l || (ctx.scopes.length && !ctx.scopes.some((s) => s.countryId === l.countryId))) throw new NotFoundError("Lead");
  return l;
}

// ── accounts ────────────────────────────────────────────────────────────────

/** Approved partner companies with sales facts: manager, tier, tags, last order, 90-day spend, open tasks. */
export async function listAccounts(ctx: Ctx, f: { type?: CompanyType; ownerId?: string; tag?: string; q?: string } = {}) {
  assertCrmView(ctx);
  const companies = await prisma.company.findMany({
    where: {
      type: f.type && PARTNER_TYPES.includes(f.type) ? f.type : { in: PARTNER_TYPES }, status: "APPROVED", ...scopeWhere(ctx),
      ...(f.ownerId ? { crmAccount: { ownerId: f.ownerId } } : {}),
      ...(f.tag ? { crmAccount: { tags: { has: f.tag } } } : {}),
      ...(f.q ? { OR: [{ legalName: { contains: f.q, mode: "insensitive" } }, { tradeName: { contains: f.q, mode: "insensitive" } }, { vatNumber: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, type: true, legalName: true, tradeName: true, isInHouse: true, country: { select: { code: true, flag: true } }, crmAccount: { include: { owner: { select: { id: true, name: true } } } } },
    orderBy: { legalName: "asc" }, take: 500,
  });
  const ids = companies.map((c) => c.id);
  const since = new Date(Date.now() - 90 * 86400_000);
  const [bought, sold, tasks, acts] = await Promise.all([
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { buyerCompanyId: { in: ids }, status: { notIn: ["CANCELLED"] } }, _max: { placedAt: true } }),
    prisma.order.groupBy({ by: ["sellerCompanyId"], where: { sellerCompanyId: { in: ids }, status: { notIn: ["CANCELLED"] } }, _max: { placedAt: true } }),
    prisma.crmTask.groupBy({ by: ["companyId"], where: { companyId: { in: ids }, status: "OPEN" }, _count: true }),
    prisma.crmActivity.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _max: { at: true } }),
  ]);
  const spendRows = ids.length
    ? await prisma.$queryRaw<{ id: string; buy: number; sell: number }[]>`
        SELECT c.id,
          COALESCE((SELECT sum(o."netTotal") FROM "Order" o WHERE o."buyerCompanyId" = c.id AND o."placedAt" >= ${since} AND o.status <> 'CANCELLED'), 0)::float8 AS buy,
          COALESCE((SELECT sum(o."netTotal") FROM "Order" o WHERE o."sellerCompanyId" = c.id AND o."placedAt" >= ${since} AND o.status <> 'CANCELLED'), 0)::float8 AS sell
        FROM "Company" c WHERE c.id IN (${Prisma.join(ids)})`
    : [];
  const m = <T extends { [k: string]: unknown }>(rows: T[], key: keyof T) => new Map(rows.map((r) => [r[key] as string, r]));
  const b = m(bought, "buyerCompanyId"), s = m(sold, "sellerCompanyId"), t = m(tasks, "companyId"), a = m(acts, "companyId"), sp = m(spendRows, "id");
  return companies.map((c) => ({
    ...c,
    lastOrderAt: (c.type === "DISTRIBUTOR" ? s.get(c.id)?._max.placedAt : b.get(c.id)?._max.placedAt ?? s.get(c.id)?._max.placedAt) ?? null,
    bought90: sp.get(c.id)?.buy ?? 0, sold90: sp.get(c.id)?.sell ?? 0,
    openTasks: (t.get(c.id)?._count as number | undefined) ?? 0, lastContactAt: a.get(c.id)?._max.at ?? null,
  }));
}

export async function setAccount(ctx: Ctx, companyId: string, i: { ownerId?: string | null; tier?: string | null; tags?: string[] }) {
  assertCrmManage(ctx);
  await assertCompanyInScope(ctx, companyId);
  await assertStaff(ctx, i.ownerId);
  if (i.tier && !["A", "B", "C"].includes(i.tier)) throw new ValidationError("Tier is A, B or C.");
  const tags = i.tags?.map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const before = await prisma.crmAccount.findUnique({ where: { companyId } });
  const acc = await prisma.crmAccount.upsert({
    where: { companyId },
    update: { ...(i.ownerId !== undefined ? { ownerId: i.ownerId } : {}), ...(i.tier !== undefined ? { tier: i.tier } : {}), ...(tags ? { tags: [...new Set(tags)] } : {}) },
    create: { companyId, ownerId: i.ownerId ?? null, tier: i.tier ?? null, tags: [...new Set(tags ?? [])] },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "crm.account_updated", entityType: "Company", entityId: companyId, before, after: acc });
  if (i.ownerId && i.ownerId !== before?.ownerId && i.ownerId !== ctx.user.id) {
    const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { legalName: true } });
    await notifyAssigned("Account", i.ownerId, c.legalName, `/admin/crm/accounts/${companyId}`);
  }
  return acc;
}

/** Everything sales needs about one company. */
export async function account360(ctx: Ctx, companyId: string) {
  assertCrmView(ctx);
  const c = await prisma.company.findFirst({
    where: { id: companyId, type: { in: PARTNER_TYPES }, ...scopeWhere(ctx) },
    include: {
      country: true, crmAccount: { include: { owner: { select: { id: true, name: true } } } },
      memberships: { where: { status: "ACTIVE" }, select: { isOwner: true, user: { select: { id: true, name: true, email: true, phone: true } } } },
      crmContacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      deals: { orderBy: { createdAt: "desc" }, include: { owner: { select: { name: true } } } },
      crmActivities: { orderBy: { at: "desc" }, take: 100, include: { by: { select: { name: true } } } },
      crmTasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }], include: { assignee: { select: { name: true } } } },
      supportTickets: { orderBy: { lastMessageAt: "desc" }, take: 20 },
      leadsConverted: { select: { id: true, number: true, source: true, createdAt: true } },
    },
  });
  if (!c) throw new NotFoundError("Company");
  const side = c.type === "DISTRIBUTOR" ? { sellerCompanyId: c.id } : { buyerCompanyId: c.id };
  const [orders, totals] = await Promise.all([
    prisma.order.findMany({ where: side, orderBy: { placedAt: "desc" }, take: 10, select: { id: true, number: true, placedAt: true, status: true, netTotal: true, seller: { select: { legalName: true } }, buyer: { select: { legalName: true } } } }),
    prisma.$queryRaw<{ n30: number; n90: number; net90: number; netAll: number; first: Date | null; last: Date | null }[]>`
      SELECT count(*) FILTER (WHERE "placedAt" >= now() - interval '30 days')::int AS n30,
             count(*) FILTER (WHERE "placedAt" >= now() - interval '90 days')::int AS n90,
             COALESCE(sum("netTotal") FILTER (WHERE "placedAt" >= now() - interval '90 days'), 0)::float8 AS net90,
             COALESCE(sum("netTotal"), 0)::float8 AS "netAll", min("placedAt") AS first, max("placedAt") AS last
      FROM "Order" WHERE status <> 'CANCELLED' AND ${c.type === "DISTRIBUTOR" ? Prisma.sql`"sellerCompanyId" = ${c.id}` : Prisma.sql`"buyerCompanyId" = ${c.id}`}`,
  ]);
  return { company: c, orders, totals: totals[0] };
}

// ── contacts ────────────────────────────────────────────────────────────────

export type ContactInput = { companyId?: string | null; leadId?: string | null; name: string; jobTitle?: string | null; email?: string | null; phone?: string | null; isPrimary?: boolean; notes?: string | null };

export async function listContacts(ctx: Ctx, q?: string) {
  assertCrmView(ctx);
  return prisma.crmContact.findMany({
    where: {
      ...inScope(ctx),
      ...(q ? { AND: [{ OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { company: { legalName: { contains: q, mode: "insensitive" } } }, { lead: { companyName: { contains: q, mode: "insensitive" } } }] }] } : {}),
    },
    include: { company: { select: { id: true, legalName: true, type: true } }, lead: { select: { id: true, number: true, companyName: true, status: true } } },
    orderBy: { name: "asc" }, take: 500,
  });
}

export async function saveContact(ctx: Ctx, id: string | null, i: ContactInput) {
  assertCrmManage(ctx);
  if (!i.name.trim()) throw new ValidationError("Enter the contact's name.");
  if (!i.companyId && !i.leadId && !id) throw new ValidationError("Choose a company or a lead.");
  await assertCompanyInScope(ctx, i.companyId);
  const data = { name: i.name.trim(), jobTitle: clean(i.jobTitle), email: clean(i.email)?.toLowerCase() ?? null, phone: clean(i.phone), isPrimary: !!i.isPrimary, notes: clean(i.notes) };
  return prisma.$transaction(async (tx) => {
    const c = id ? await tx.crmContact.update({ where: { id }, data }) : await tx.crmContact.create({ data: { ...data, companyId: i.companyId ?? null, leadId: i.leadId ?? null } });
    if (c.isPrimary) await tx.crmContact.updateMany({ where: { id: { not: c.id }, ...(c.companyId ? { companyId: c.companyId } : { leadId: c.leadId }) }, data: { isPrimary: false } });
    return c;
  });
}

export async function deleteContact(ctx: Ctx, id: string) {
  assertCrmManage(ctx);
  await prisma.crmContact.delete({ where: { id } });
}

// ── deals (pipeline) ────────────────────────────────────────────────────────

export const STAGES: DealStage[] = ["PROSPECTING", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
const STAGE_PROBABILITY: Record<DealStage, number> = { PROSPECTING: 10, QUALIFIED: 25, PROPOSAL: 50, NEGOTIATION: 75, WON: 100, LOST: 0 };

export type DealInput = { title: string; companyId?: string | null; leadId?: string | null; valueNet: number; expectedCloseAt?: Date | null; ownerId?: string | null; stage?: DealStage };

export async function pipeline(ctx: Ctx, f: { ownerId?: string } = {}) {
  assertCrmView(ctx);
  const deals = await prisma.deal.findMany({
    where: { ...(f.ownerId ? { ownerId: f.ownerId } : {}), AND: [inScope(ctx), { OR: [{ stage: { notIn: ["WON", "LOST"] } }, { closedAt: { gte: new Date(Date.now() - 90 * 86400_000) } }] }] },
    include: { company: { select: { id: true, legalName: true } }, lead: { select: { id: true, companyName: true } }, owner: { select: { name: true } } },
    orderBy: [{ expectedCloseAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
  return STAGES.map((stage) => {
    const ds = deals.filter((d) => d.stage === stage);
    return { stage, deals: ds, value: ds.reduce((a, d) => a + Number(d.valueNet), 0), weighted: ds.reduce((a, d) => a + (Number(d.valueNet) * d.probability) / 100, 0) };
  });
}

export async function createDeal(ctx: Ctx, i: DealInput) {
  assertCrmManage(ctx);
  if (!i.title.trim()) throw new ValidationError("Give the deal a title.");
  if (!i.companyId && !i.leadId) throw new ValidationError("Choose a company or a lead.");
  if (!(i.valueNet >= 0)) throw new ValidationError("Enter the expected monthly value.");
  await assertCompanyInScope(ctx, i.companyId);
  await assertStaff(ctx, i.ownerId);
  const stage = i.stage ?? "PROSPECTING";
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "deal", "DL");
    const d = await tx.deal.create({
      data: { number, title: i.title.trim(), companyId: i.companyId ?? null, leadId: i.leadId ?? null, valueNet: i.valueNet, stage, probability: STAGE_PROBABILITY[stage], expectedCloseAt: i.expectedCloseAt ?? null, ownerId: i.ownerId ?? ctx.user.id, createdById: ctx.user.id },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "crm.deal_created", entityType: "Deal", entityId: d.id, after: { number, title: d.title, valueNet: i.valueNet } }, tx);
    return d;
  });
}

export async function moveDeal(ctx: Ctx, id: string, stage: DealStage, lostReason?: string | null) {
  assertCrmManage(ctx);
  const d = await prisma.deal.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("Deal");
  if (stage === "LOST" && !clean(lostReason)) throw new ValidationError("Say why the deal was lost.");
  const closed = stage === "WON" || stage === "LOST";
  const u = await prisma.deal.update({ where: { id }, data: { stage, probability: STAGE_PROBABILITY[stage], lostReason: stage === "LOST" ? clean(lostReason) : null, closedAt: closed ? new Date() : null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "crm.deal_stage", entityType: "Deal", entityId: id, before: { stage: d.stage }, after: { stage, lostReason } });
  return u;
}

export async function updateDeal(ctx: Ctx, id: string, i: Partial<Pick<DealInput, "title" | "valueNet" | "expectedCloseAt" | "ownerId">> & { probability?: number }) {
  assertCrmManage(ctx);
  await assertStaff(ctx, i.ownerId);
  if (i.probability !== undefined && (i.probability < 0 || i.probability > 100)) throw new ValidationError("Probability is 0–100 %.");
  return prisma.deal.update({
    where: { id },
    data: { ...(i.title ? { title: i.title.trim() } : {}), ...(i.valueNet !== undefined ? { valueNet: i.valueNet } : {}), ...(i.expectedCloseAt !== undefined ? { expectedCloseAt: i.expectedCloseAt } : {}), ...(i.ownerId !== undefined ? { ownerId: i.ownerId } : {}), ...(i.probability !== undefined ? { probability: Math.round(i.probability) } : {}) },
  });
}

export async function dealDetail(ctx: Ctx, id: string) {
  assertCrmView(ctx);
  const d = await prisma.deal.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, legalName: true } }, lead: { select: { id: true, number: true, companyName: true } }, owner: { select: { id: true, name: true } },
      activities: { orderBy: { at: "desc" }, include: { by: { select: { name: true } } } }, tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }], include: { assignee: { select: { name: true } } } },
    },
  });
  if (!d) throw new NotFoundError("Deal");
  if (d.companyId) await assertCompanyInScope(ctx, d.companyId);
  return d;
}

// ── activities (communications & notes) ─────────────────────────────────────

export type ActivityInput = { kind: CrmActivityKind; subject: string; body?: string | null; at?: Date | null; outbound?: boolean; companyId?: string | null; leadId?: string | null; dealId?: string | null };

export async function logActivity(ctx: Ctx, i: ActivityInput) {
  assertCrmManage(ctx);
  if (!i.subject.trim()) throw new ValidationError(i.kind === "NOTE" ? "Write the note." : "Enter a subject.");
  if (!i.companyId && !i.leadId && !i.dealId) throw new ValidationError("Choose a company, a lead or a deal.");
  await assertCompanyInScope(ctx, i.companyId);
  if (i.at && i.at.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("An activity can't be in the future — add a follow-up instead.");
  // A deal's company / lead are recorded too, so the activity shows on the account and the lead.
  const deal = i.dealId ? await prisma.deal.findUnique({ where: { id: i.dealId }, select: { companyId: true, leadId: true } }) : null;
  const a = await prisma.crmActivity.create({
    data: {
      kind: i.kind, subject: i.subject.trim(), body: clean(i.body), at: i.at ?? new Date(), outbound: i.kind === "NOTE" ? true : i.outbound ?? true,
      companyId: i.companyId ?? deal?.companyId ?? null, leadId: i.leadId ?? deal?.leadId ?? null, dealId: i.dealId ?? null, byUserId: ctx.user.id,
    },
  });
  // First touch moves a new lead to "contacted".
  if (a.leadId && a.kind !== "NOTE") await prisma.lead.updateMany({ where: { id: a.leadId, status: "NEW" }, data: { status: "CONTACTED" } });
  return a;
}

export async function listActivities(ctx: Ctx, f: { notes?: boolean; kind?: CrmActivityKind; byUserId?: string; q?: string; days?: number } = {}) {
  assertCrmView(ctx);
  return prisma.crmActivity.findMany({
    where: {
      kind: f.notes ? "NOTE" : f.kind ? f.kind : { not: "NOTE" },
      ...(f.byUserId ? { byUserId: f.byUserId } : {}),
      ...(f.days ? { at: { gte: new Date(Date.now() - f.days * 86400_000) } } : {}),
      ...inScope(ctx),
      ...(f.q ? { AND: [{ OR: [{ subject: { contains: f.q, mode: "insensitive" } }, { body: { contains: f.q, mode: "insensitive" } }, { company: { legalName: { contains: f.q, mode: "insensitive" } } }, { lead: { companyName: { contains: f.q, mode: "insensitive" } } }] }] } : {}),
    },
    include: { company: { select: { id: true, legalName: true } }, lead: { select: { id: true, number: true, companyName: true } }, deal: { select: { id: true, number: true, title: true } }, by: { select: { name: true } } },
    orderBy: { at: "desc" }, take: 300,
  });
}

// ── tasks & follow-ups ──────────────────────────────────────────────────────

export type TaskInput = { kind?: CrmTaskKind; title: string; notes?: string | null; dueAt: Date; assigneeId?: string | null; companyId?: string | null; leadId?: string | null; dealId?: string | null };

export async function createTask(ctx: Ctx, i: TaskInput) {
  assertCrmManage(ctx);
  if (!i.title.trim()) throw new ValidationError("Enter what has to be done.");
  if (!(i.dueAt instanceof Date) || Number.isNaN(i.dueAt.getTime())) throw new ValidationError("Choose a due date.");
  const kind = i.kind ?? "TASK";
  if (kind === "FOLLOW_UP" && !i.companyId && !i.leadId && !i.dealId) throw new ValidationError("A follow-up is about a company, a lead or a deal.");
  await assertCompanyInScope(ctx, i.companyId);
  const assigneeId = i.assigneeId ?? ctx.user.id;
  await assertStaff(ctx, assigneeId);
  const t = await prisma.crmTask.create({
    data: { kind, title: i.title.trim(), notes: clean(i.notes), dueAt: i.dueAt, assigneeId, companyId: i.companyId ?? null, leadId: i.leadId ?? null, dealId: i.dealId ?? null, createdById: ctx.user.id },
  });
  if (assigneeId !== ctx.user.id) await notify("crm.task_assigned", [{ userId: assigneeId, link: kind === "FOLLOW_UP" ? "/admin/crm/follow-ups" : "/admin/crm/tasks" }], { title: t.title, due: t.dueAt.toISOString().slice(0, 10) }, { ref: { type: "CrmTask", id: t.id } });
  return t;
}

export async function setTaskStatus(ctx: Ctx, id: string, status: "DONE" | "CANCELLED" | "OPEN") {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const t = await prisma.crmTask.findUnique({ where: { id } });
  if (!t) throw new NotFoundError("Task");
  // Your own tasks: always; others' tasks: CRM managers.
  if (t.assigneeId !== ctx.user.id) assertCrmManage(ctx); else assertCrmView(ctx);
  return prisma.crmTask.update({ where: { id }, data: { status, doneAt: status === "DONE" ? new Date() : null } });
}

export async function listTasks(ctx: Ctx, f: { kind?: CrmTaskKind; assigneeId?: string; status?: "OPEN" | "DONE" | "ALL"; overdue?: boolean } = {}) {
  assertCrmView(ctx);
  return prisma.crmTask.findMany({
    where: {
      ...(f.kind ? { kind: f.kind } : {}), ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
      ...(f.status === "ALL" ? {} : { status: f.status ?? "OPEN" }),
      ...(f.overdue ? { dueAt: { lt: new Date() } } : {}),
      ...inScope(ctx),
    },
    include: { assignee: { select: { id: true, name: true } }, company: { select: { id: true, legalName: true } }, lead: { select: { id: true, number: true, companyName: true } }, deal: { select: { id: true, number: true, title: true } } },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 500,
  });
}

/** In-app note to a teammate who was given a lead / account. */
async function notifyAssigned(what: "Lead" | "Account", userId: string, name: string, link: string) {
  await notify("crm.task_assigned", [{ userId, link }], { title: `${what === "Lead" ? "Lead" : "Account"}: ${name}`, due: new Date().toISOString().slice(0, 10) });
}

/** Companies and open leads for pickers. */
export async function crmTargets(ctx: Ctx) {
  assertCrmView(ctx);
  const [companies, leads] = await Promise.all([
    prisma.company.findMany({ where: { type: { in: PARTNER_TYPES }, status: { in: ["APPROVED", "PENDING", "UNDER_REVIEW"] }, ...scopeWhere(ctx) }, select: { id: true, legalName: true, type: true }, orderBy: { legalName: "asc" }, take: 1000 }),
    prisma.lead.findMany({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } }, select: { id: true, number: true, companyName: true }, orderBy: { companyName: "asc" }, take: 1000 }),
  ]);
  return { companies, leads };
}

/** Active countries for CRM forms (code + flag + name). */
export async function crmCountries() {
  const cs = await prisma.country.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { code: true, flag: true, name: true } });
  return cs.map((c) => ({ id: c.code, label: `${c.flag ?? ""} ${(c.name as Record<string, string>).en ?? c.code}`.trim() }));
}
