import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { requirePermission } from "@/server/rbac/guard";

/** Executive overview numbers for the admin dashboard (Phase 1: accounts & platform). */
export async function adminOverview(ctx: Ctx) {
  requirePermission(ctx, "admin.dashboard.view");
  const [byTypeStatus, users, countries, recent] = await Promise.all([
    prisma.company.groupBy({ by: ["type", "status"], _count: { _all: true }, where: { type: { not: "ADMIN" } } }),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.country.groupBy({
      by: ["customerMarketEnabled", "distributorSourcingEnabled"],
      _count: { _all: true },
      where: { isActive: true },
    }),
    prisma.company.findMany({
      where: { type: { not: "ADMIN" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, legalName: true, type: true, status: true, createdAt: true, country: { select: { code: true, flag: true } } },
    }),
  ]);
  const count = (type: string, statuses?: string[]) =>
    byTypeStatus.filter((r) => r.type === type && (!statuses || statuses.includes(r.status))).reduce((a, r) => a + r._count._all, 0);
  const pendingStatuses = ["PENDING", "UNDER_REVIEW"];
  return {
    distributors: { total: count("DISTRIBUTOR"), active: count("DISTRIBUTOR", ["APPROVED"]), pending: count("DISTRIBUTOR", pendingStatuses) },
    wholesalers: { total: count("WHOLESALER"), active: count("WHOLESALER", ["APPROVED"]), pending: count("WHOLESALER", pendingStatuses) },
    customers: { total: count("CUSTOMER"), active: count("CUSTOMER", ["APPROVED"]), pending: count("CUSTOMER", pendingStatuses) },
    activeUsers: users,
    customerMarkets: countries.filter((c) => c.customerMarketEnabled).reduce((a, r) => a + r._count._all, 0),
    sourcingCountries: countries.filter((c) => c.distributorSourcingEnabled).reduce((a, r) => a + r._count._all, 0),
    recent,
  };
}

/** Small company dashboard (vendor / buyer portals) — Phase 1: account + team facts. */
export async function companyOverview(ctx: Ctx) {
  const [members, roles, company] = await Promise.all([
    prisma.membership.count({ where: { companyId: ctx.company.id, status: "ACTIVE" } }),
    prisma.role.count({ where: { companyId: ctx.company.id } }),
    prisma.company.findUniqueOrThrow({
      where: { id: ctx.company.id },
      select: { legalName: true, tradeName: true, taxId: true, vatNumber: true, approvedAt: true, country: { select: { code: true, flag: true } } },
    }),
  ]);
  return { members, customRoles: roles, company };
}
