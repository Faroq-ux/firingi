/**
 * CRM insights: customer activity (who orders, who is slipping away), saved customer
 * segments (live rules) and sales performance per team member.
 *
 * Activity status of a buying company (customers, and wholesalers as buyers):
 *   NEVER_ORDERED — approved, no order yet
 *   NEW           — first order in the last 30 days
 *   DORMANT       — no order for more than 90 days
 *   AT_RISK       — no order for longer than twice its usual gap (at least 30 days)
 *   ACTIVE        — otherwise
 */
import { Prisma, type CompanyType } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { can } from "@/server/rbac/guard";
import { scopeWhere } from "./admin-access";
import { assertCrmManage, assertCrmView } from "./crm";
import { writeAudit } from "./audit";

export const ACTIVITY_STATUSES = ["ACTIVE", "NEW", "AT_RISK", "DORMANT", "NEVER_ORDERED"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export type ActivityRow = {
  id: string; legalName: string; type: CompanyType; countryCode: string; flag: string | null; regionId: string | null; tags: string[]; tier: string | null; ownerId: string | null; owner: string | null;
  orders30: number; orders90: number; spend90: number; spendPrev90: number; firstOrderAt: Date | null; lastOrderAt: Date | null; avgGapDays: number | null; daysSince: number | null;
  lastLoginAt: Date | null; status: ActivityStatus; groupIds: string[];
};

function statusOf(r: { firstOrderAt: Date | null; daysSince: number | null; avgGapDays: number | null }): ActivityStatus {
  if (!r.firstOrderAt || r.daysSince === null) return "NEVER_ORDERED";
  if (Date.now() - r.firstOrderAt.getTime() <= 30 * 86400_000) return "NEW";
  if (r.daysSince > 90) return "DORMANT";
  if (r.daysSince > Math.max(30, 2 * (r.avgGapDays ?? 15))) return "AT_RISK";
  return "ACTIVE";
}

/** Buying companies (customers + wholesalers) with their ordering pattern. */
export async function customerActivity(ctx: Ctx): Promise<ActivityRow[]> {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.crm.view", "admin.crm.manage", "admin.customers.view"])) throw new ForbiddenError();
  return activityRows(scopeWhere(ctx));
}

/** Activity rows without a permission check — server use only (segment checks at checkout, campaign audiences). */
export async function activityRows(where: Prisma.CompanyWhereInput = {}): Promise<ActivityRow[]> {
  const companies = await prisma.company.findMany({
    where: { type: { in: ["CUSTOMER", "WHOLESALER"] }, status: "APPROVED", isInHouse: false, ...where },
    select: {
      id: true, legalName: true, type: true, country: { select: { code: true, flag: true } }, crmAccount: { select: { tags: true, tier: true, ownerId: true, owner: { select: { name: true } } } },
      addresses: { where: { kind: "HEAD_OFFICE", isActive: true }, select: { city: { select: { regionId: true } } }, take: 1 },
      customerGroupMemberships: { select: { groupId: true } },
    },
  });
  if (!companies.length) return [];
  const ids = companies.map((c) => c.id);
  const stats = await prisma.$queryRaw<{ id: string; o30: number; o90: number; s90: number; sp90: number; first: Date | null; last: Date | null; gap: number | null; login: Date | null }[]>`
    WITH o AS (
      SELECT "buyerCompanyId" AS id, "placedAt", "netTotal",
             EXTRACT(EPOCH FROM "placedAt" - lag("placedAt") OVER (PARTITION BY "buyerCompanyId" ORDER BY "placedAt")) / 86400 AS gap,
             row_number() OVER (PARTITION BY "buyerCompanyId" ORDER BY "placedAt" DESC) AS rn
      FROM "Order" WHERE status <> 'CANCELLED' AND "buyerCompanyId" IN (${Prisma.join(ids)})
    )
    SELECT c.id,
      (SELECT count(*) FROM o WHERE o.id = c.id AND o."placedAt" >= now() - interval '30 days')::int AS o30,
      (SELECT count(*) FROM o WHERE o.id = c.id AND o."placedAt" >= now() - interval '90 days')::int AS o90,
      COALESCE((SELECT sum("netTotal") FROM o WHERE o.id = c.id AND o."placedAt" >= now() - interval '90 days'), 0)::float8 AS s90,
      COALESCE((SELECT sum("netTotal") FROM o WHERE o.id = c.id AND o."placedAt" >= now() - interval '180 days' AND o."placedAt" < now() - interval '90 days'), 0)::float8 AS sp90,
      (SELECT min("placedAt") FROM o WHERE o.id = c.id) AS first,
      (SELECT max("placedAt") FROM o WHERE o.id = c.id) AS last,
      (SELECT avg(gap) FROM o WHERE o.id = c.id AND rn <= 10 AND gap IS NOT NULL)::float8 AS gap,
      (SELECT max(s."createdAt") FROM "Session" s JOIN "Membership" m ON m."userId" = s."userId" WHERE m."companyId" = c.id) AS login
    FROM "Company" c WHERE c.id IN (${Prisma.join(ids)})`;
  const by = new Map(stats.map((s) => [s.id, s]));
  return companies.map((c) => {
    const s = by.get(c.id)!;
    const daysSince = s.last ? Math.floor((Date.now() - s.last.getTime()) / 86400_000) : null;
    const row = {
      id: c.id, legalName: c.legalName, type: c.type, countryCode: c.country.code, flag: c.country.flag, regionId: c.addresses[0]?.city?.regionId ?? null,
      tags: c.crmAccount?.tags ?? [], tier: c.crmAccount?.tier ?? null, ownerId: c.crmAccount?.ownerId ?? null, owner: c.crmAccount?.owner?.name ?? null,
      orders30: s.o30, orders90: s.o90, spend90: s.s90, spendPrev90: s.sp90, firstOrderAt: s.first, lastOrderAt: s.last,
      avgGapDays: s.gap === null ? null : Math.round(s.gap * 10) / 10, daysSince, lastLoginAt: s.login, groupIds: c.customerGroupMemberships.map((g) => g.groupId),
    };
    return { ...row, status: statusOf(row) };
  });
}

// ── segments ────────────────────────────────────────────────────────────────

export type SegmentRules = {
  types?: ("CUSTOMER" | "WHOLESALER")[];
  countryCodes?: string[];
  regionIds?: string[];
  groupIds?: string[];
  tags?: string[];
  tiers?: string[];
  ownerId?: string | null;
  statuses?: ActivityStatus[];
  minSpend90?: number | null;
  maxSpend90?: number | null;
};

export function matchesSegment(r: ActivityRow, rules: SegmentRules) {
  if (rules.types?.length && !rules.types.includes(r.type as "CUSTOMER")) return false;
  if (rules.countryCodes?.length && !rules.countryCodes.includes(r.countryCode)) return false;
  if (rules.regionIds?.length && (!r.regionId || !rules.regionIds.includes(r.regionId))) return false;
  if (rules.groupIds?.length && !rules.groupIds.some((g) => r.groupIds.includes(g))) return false;
  if (rules.tags?.length && !rules.tags.some((t) => r.tags.includes(t))) return false;
  if (rules.tiers?.length && (!r.tier || !rules.tiers.includes(r.tier))) return false;
  if (rules.ownerId && r.ownerId !== rules.ownerId) return false;
  if (rules.statuses?.length && !rules.statuses.includes(r.status)) return false;
  if (rules.minSpend90 != null && r.spend90 < rules.minSpend90) return false;
  if (rules.maxSpend90 != null && r.spend90 > rules.maxSpend90) return false;
  return true;
}

export function normaliseRules(raw: unknown): SegmentRules {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : undefined);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const out: SegmentRules = {
    types: arr(r.types)?.filter((t) => t === "CUSTOMER" || t === "WHOLESALER") as SegmentRules["types"],
    countryCodes: arr(r.countryCodes), regionIds: arr(r.regionIds), groupIds: arr(r.groupIds), tags: arr(r.tags)?.map((t) => t.toLowerCase()), tiers: arr(r.tiers),
    ownerId: typeof r.ownerId === "string" && r.ownerId ? r.ownerId : null,
    statuses: arr(r.statuses)?.filter((s) => (ACTIVITY_STATUSES as readonly string[]).includes(s)) as ActivityStatus[],
    minSpend90: num(r.minSpend90), maxSpend90: num(r.maxSpend90),
  };
  if (out.minSpend90 != null && out.maxSpend90 != null && out.minSpend90 > out.maxSpend90) throw new ValidationError("Minimum spend is above the maximum.");
  return out;
}

export async function listSegments(ctx: Ctx) {
  assertCrmView(ctx);
  const [segments, rows] = await Promise.all([prisma.crmSegment.findMany({ orderBy: { name: "asc" } }), customerActivity(ctx)]);
  return segments.map((s) => {
    const rules = normaliseRules(s.rules);
    const members = rows.filter((r) => matchesSegment(r, rules));
    return { ...s, rules, count: members.length, spend90: members.reduce((a, m) => a + m.spend90, 0) };
  });
}

export async function segmentMembers(ctx: Ctx, idOrRules: string | SegmentRules) {
  const rules = typeof idOrRules === "string" ? normaliseRules((await prisma.crmSegment.findUniqueOrThrow({ where: { id: idOrRules } })).rules) : normaliseRules(idOrRules);
  return (await customerActivity(ctx)).filter((r) => matchesSegment(r, rules));
}

export async function saveSegment(ctx: Ctx, id: string | null, i: { name: string; description?: string | null; rules: unknown }) {
  assertCrmManage(ctx);
  const name = i.name.trim();
  if (!name) throw new ValidationError("Name the segment.");
  const rules = normaliseRules(i.rules);
  const data = { name, description: i.description?.trim() || null, rules: rules as Prisma.InputJsonValue };
  const s = id ? await prisma.crmSegment.update({ where: { id }, data }) : await prisma.crmSegment.create({ data: { ...data, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "crm.segment_saved", entityType: "CrmSegment", entityId: s.id, after: data });
  return s;
}

export async function deleteSegment(ctx: Ctx, id: string) {
  assertCrmManage(ctx);
  await prisma.crmSegment.delete({ where: { id } });
}

// ── sales performance ───────────────────────────────────────────────────────

export async function salesPerformance(ctx: Ctx, p: { from: Date; to: Date }) {
  assertCrmView(ctx);
  const staff = await prisma.membership.findMany({ where: { companyId: ctx.company.id, status: "ACTIVE" }, select: { user: { select: { id: true, name: true } } } });
  const ids = staff.map((s) => s.user.id);
  const inP = { gte: p.from, lte: p.to };
  const [leadsNew, converted, won, open, acts, done, overdue, owned] = await Promise.all([
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, createdAt: inP }, _count: true }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, convertedAt: inP }, _count: true }),
    prisma.deal.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, stage: "WON", closedAt: inP }, _count: true, _sum: { valueNet: true } }),
    prisma.deal.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, stage: { notIn: ["WON", "LOST"] } }, _sum: { valueNet: true } }),
    prisma.crmActivity.groupBy({ by: ["byUserId"], where: { byUserId: { in: ids }, kind: { not: "NOTE" }, at: inP }, _count: true }),
    prisma.crmTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: "DONE", doneAt: inP }, _count: true }),
    prisma.crmTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: "OPEN", dueAt: { lt: new Date() } }, _count: true }),
    prisma.crmAccount.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids } }, _count: true }),
  ]);
  const revenue = ids.length
    ? await prisma.$queryRaw<{ ownerId: string; net: number; orders: number }[]>`
        SELECT a."ownerId", COALESCE(sum(o."netTotal"), 0)::float8 AS net, count(o.id)::int AS orders
        FROM "CrmAccount" a JOIN "Order" o ON o."buyerCompanyId" = a."companyId"
        WHERE a."ownerId" IN (${Prisma.join(ids)}) AND o.status <> 'CANCELLED' AND o."placedAt" >= ${p.from} AND o."placedAt" <= ${p.to}
        GROUP BY a."ownerId"`
    : [];
  const get = <T extends Record<string, unknown>>(rows: T[], key: keyof T, id: string) => rows.find((r) => r[key] === id);
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return staff.map(({ user: u }) => {
    const w = get(won, "ownerId", u.id);
    return {
      id: u.id, name: u.name,
      leadsNew: n(get(leadsNew, "ownerId", u.id)?._count), leadsConverted: n(get(converted, "ownerId", u.id)?._count),
      dealsWon: n(w?._count), wonValue: Number(w?._sum.valueNet ?? 0), pipelineValue: Number(get(open, "ownerId", u.id)?._sum.valueNet ?? 0),
      activities: n(get(acts, "byUserId", u.id)?._count), tasksDone: n(get(done, "assigneeId", u.id)?._count), tasksOverdue: n(get(overdue, "assigneeId", u.id)?._count),
      accounts: n(get(owned, "ownerId", u.id)?._count), accountRevenue: get(revenue, "ownerId", u.id)?.net ?? 0, accountOrders: get(revenue, "ownerId", u.id)?.orders ?? 0,
    };
  }).filter((r) => r.leadsNew + r.leadsConverted + r.dealsWon + r.pipelineValue + r.activities + r.tasksDone + r.tasksOverdue + r.accounts > 0)
    .sort((a, b) => b.wonValue - a.wonValue || b.accountRevenue - a.accountRevenue || a.name.localeCompare(b.name));
}
