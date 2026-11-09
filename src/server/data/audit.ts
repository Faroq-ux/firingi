import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { requirePermission } from "@/server/rbac/guard";

export async function listAuditLogs(ctx: Ctx, filter: { action?: string; entityType?: string; page?: number }) {
  requirePermission(ctx, ["admin.audit.view", "admin.settings.view"]);
  const pageSize = 50;
  const page = Math.max(1, filter.page ?? 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(filter.action ? { action: { contains: filter.action, mode: "insensitive" } } : {}),
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  // Resolve actor names in one query (actor fields are soft references).
  const userIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const companyIds = [...new Set(rows.map((r) => r.actorCompanyId).filter(Boolean))] as string[];
  const [users, companies] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
    prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, legalName: true } }),
  ]);
  const u = new Map(users.map((x) => [x.id, x.email]));
  const c = new Map(companies.map((x) => [x.id, x.legalName]));
  return {
    rows: rows.map((r) => ({ ...r, actorEmail: r.actorUserId ? u.get(r.actorUserId) ?? null : null, actorCompany: r.actorCompanyId ? c.get(r.actorCompanyId) ?? null : null })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listAuditEntityTypes(ctx: Ctx) {
  requirePermission(ctx, ["admin.audit.view", "admin.settings.view"]);
  const rows = await prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } });
  return rows.map((r) => r.entityType).sort();
}
