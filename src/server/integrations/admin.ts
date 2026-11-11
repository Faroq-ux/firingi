/** FIRINGI staff: one view of every company's integrations — keys, API traffic, webhooks, feeds, problems. */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";

export async function integrationsOverview(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
  const day = new Date(Date.now() - 86400_000), week = new Date(Date.now() - 7 * 86400_000);
  const [keys, calls24, errors24, calls7byDay, endpoints, pending, failed24, feeds, runs, topKeys] = await Promise.all([
    prisma.apiKey.findMany({ where: { revokedAt: null }, select: { id: true, name: true, selfService: true, lastUsedAt: true, scopes: true, company: { select: { legalName: true, tradeName: true, type: true } } } }),
    prisma.apiCallLog.count({ where: { at: { gte: day } } }),
    prisma.apiCallLog.count({ where: { at: { gte: day }, status: { gte: 400 } } }),
    prisma.$queryRaw<{ d: Date; n: bigint }[]>`SELECT date_trunc('day', "at") AS d, count(*)::bigint AS n FROM "ApiCallLog" WHERE "at" >= ${week} GROUP BY 1 ORDER BY 1`,
    prisma.webhookEndpoint.findMany({ include: { company: { select: { legalName: true, tradeName: true } } }, orderBy: [{ active: "asc" }, { failureStreak: "desc" }] }),
    prisma.webhookDelivery.count({ where: { status: "PENDING" } }),
    prisma.webhookDelivery.count({ where: { status: "FAILED", createdAt: { gte: day } } }),
    prisma.importProfile.findMany({ where: { feedUrl: { not: null } }, include: { company: { select: { legalName: true, tradeName: true } }, runs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, heldReason: true, error: true, createdAt: true } } } }),
    prisma.importRun.groupBy({ by: ["source", "status"], where: { createdAt: { gte: week } }, _count: true }),
    prisma.apiCallLog.groupBy({ by: ["apiKeyId"], where: { at: { gte: week } }, _count: true, orderBy: { _count: { apiKeyId: "desc" } }, take: 8 }),
  ]);
  const name = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;
  const keyName = new Map(keys.map((k) => [k.id, `${k.name} · ${name(k.company)}`]));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * 86400_000); return d.toISOString().slice(0, 10); });
  const perDay = new Map(calls7byDay.map((r) => [new Date(r.d).toISOString().slice(0, 10), Number(r.n)]));
  return {
    keys: { active: keys.length, selfService: keys.filter((k) => k.selfService).length, usedToday: keys.filter((k) => k.lastUsedAt && k.lastUsedAt >= day).length },
    calls: { last24h: calls24, errors24h: errors24, perDay: days.map((d) => perDay.get(d) ?? 0) },
    topKeys: topKeys.map((k) => ({ name: keyName.get(k.apiKeyId) ?? "revoked key", calls: k._count })),
    webhooks: {
      active: endpoints.filter((e) => e.active).length, off: endpoints.filter((e) => !e.active).length, pending, failed24h: failed24,
      problems: endpoints.filter((e) => !e.active || e.failureStreak > 0).slice(0, 12).map((e) => ({ id: e.id, company: name(e.company), url: e.url, active: e.active, streak: e.failureStreak, reason: e.disabledReason, lastFailureAt: e.lastFailureAt })),
    },
    feeds: feeds.map((f) => ({ id: f.id, company: name(f.company), name: f.name, enabled: f.enabled, everyHours: f.everyHours, lastRunAt: f.lastRunAt, last: f.runs[0] ?? null })),
    runs: runs.map((r) => ({ source: r.source, status: r.status, count: r._count })),
  };
}
