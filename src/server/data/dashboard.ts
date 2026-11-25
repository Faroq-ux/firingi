import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { creditStatuses } from "@/server/services/payments";
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
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const [ordersToday, awaiting, exceptions, monthAgg] = await Promise.all([
    prisma.order.count({ where: { placedAt: { gte: today } } }),
    prisma.order.count({ where: { status: "PENDING_CONFIRMATION" } }),
    prisma.orderException.count({ where: { isResolved: false } }),
    prisma.order.aggregate({ where: { placedAt: { gte: month }, status: { notIn: ["CANCELLED"] } }, _sum: { netTotal: true, firingiMarginNet: true }, _count: { _all: true } }),
  ]);
  return {
    distributors: { total: count("DISTRIBUTOR"), active: count("DISTRIBUTOR", ["APPROVED"]), pending: count("DISTRIBUTOR", pendingStatuses) },
    wholesalers: { total: count("WHOLESALER"), active: count("WHOLESALER", ["APPROVED"]), pending: count("WHOLESALER", pendingStatuses) },
    customers: { total: count("CUSTOMER"), active: count("CUSTOMER", ["APPROVED"]), pending: count("CUSTOMER", pendingStatuses) },
    activeUsers: users,
    customerMarkets: countries.filter((c) => c.customerMarketEnabled).reduce((a, r) => a + r._count._all, 0),
    sourcingCountries: countries.filter((c) => c.distributorSourcingEnabled).reduce((a, r) => a + r._count._all, 0),
    recent,
    orders: {
      today: ordersToday, awaiting, exceptions, monthCount: monthAgg._count._all,
      monthNet: monthAgg._sum.netTotal?.toString() ?? "0", monthMargin: monthAgg._sum.firingiMarginNet?.toString() ?? "0",
    },
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

// ── Live dashboard data (motion dashboards) ─────────────────────────────────


/** Net sales and order count per day for the last `days` days (zero-filled). */
async function dailySeries(where: Prisma.Sql, days = 14) {
  const rows = await prisma.$queryRaw<{ d: Date; net: number; n: number }[]>`
    SELECT date_trunc('day', "placedAt") AS d, COALESCE(sum("netTotal"), 0)::float8 AS net, count(*)::int AS n
    FROM "Order" WHERE status <> 'CANCELLED' AND "placedAt" >= date_trunc('day', now()) - (${days - 1} * interval '1 day') AND ${where}
    GROUP BY 1`;
  const by = new Map(rows.map((r) => [r.d.toISOString().slice(0, 10), r]));
  const out: { day: string; net: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const key = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
    const r = by.get(key) ?? [...by.entries()].find(([k]) => k === d.toISOString().slice(0, 10))?.[1];
    out.push({ day: key, net: r?.net ?? 0, orders: r?.n ?? 0 });
  }
  return out;
}

type TickerOrder = { id: string; number: string; who: string; city: string | null; net: string; placedAt: Date; status: string };
async function latestOrders(where: Prisma.OrderWhereInput, who: "buyer" | "seller", take = 14, named: (id: string, n: string) => string = (_i, n) => n): Promise<TickerOrder[]> {
  const rows = await prisma.order.findMany({
    where, orderBy: { placedAt: "desc" }, take,
    select: { id: true, number: true, netTotal: true, placedAt: true, status: true, deliveryAddress: true, routedByFiringi: true, buyer: { select: { tradeName: true, legalName: true } }, sellerCompanyId: true, seller: { select: { tradeName: true, legalName: true } } },
  });
  return rows.map((o) => ({
    id: o.id, number: o.number, net: o.netTotal.toString(), placedAt: o.placedAt, status: o.status, city: (o.deliveryAddress as { city?: string }).city ?? null,
    who: who === "buyer" ? o.buyer.tradeName ?? o.buyer.legalName : o.routedByFiringi ? "FIRINGI" : named(o.sellerCompanyId, o.seller.tradeName ?? o.seller.legalName),
  }));
}

/** Deliveries of today for an executing company (or all): done vs still to do. */
async function deliveriesToday(where: Prisma.DeliveryWhereInput) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [done, open, failed] = await Promise.all([
    prisma.delivery.count({ where: { ...where, status: "DELIVERED", completedAt: { gte: today } } }),
    prisma.delivery.count({ where: { ...where, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] } } }),
    prisma.delivery.count({ where: { ...where, status: "FAILED" } }),
  ]);
  return { done, open, failed, total: done + open };
}

/** Open routes of today with coordinates, for the live map. */
export async function liveMapRoutes(where: Prisma.RouteWhereInput) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const routes = await prisma.route.findMany({
    where: { ...where, OR: [{ status: { in: ["PLANNED", "IN_PROGRESS"] } }, { status: "COMPLETED", completedAt: { gte: today } }] },
    include: { driver: { select: { user: { select: { name: true } } } }, stops: { orderBy: { sequence: "asc" }, select: { lat: true, lng: true, doneAt: true, kind: true } } },
    orderBy: { plannedStartAt: "asc" }, take: 8,
  });
  return routes.map((r) => ({
    id: r.id, label: `${r.number} · ${r.driver?.user.name ?? "—"}`, status: r.status,
    start: r.startLat !== null && r.startLng !== null ? { lat: Number(r.startLat), lng: Number(r.startLng) } : null,
    stops: r.stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ lat: Number(s.lat), lng: Number(s.lng), done: !!s.doneAt, kind: s.kind })),
    done: r.stops.filter((s) => s.doneAt).length, total: r.stops.length,
  }));
}

/** FIRINGI admin: live layer of the executive overview. */
export async function adminLive(ctx: Ctx) {
  requirePermission(ctx, "admin.dashboard.view");
  const [series, latest, deliveries, routes] = await Promise.all([
    dailySeries(Prisma.sql`TRUE`), latestOrders({}, "buyer"), deliveriesToday({}), liveMapRoutes({}),
  ]);
  return { series, latest, deliveries, routes };
}

/** Supplier dashboard: orders to confirm, sales, payout, deliveries, top products. */
export async function vendorLive(ctx: Ctx) {
  const me = ctx.company.id;
  const since30 = new Date(Date.now() - 30 * 86400_000), since60 = new Date(Date.now() - 60 * 86400_000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [toConfirm, ordersToday, cur, prev, series, latest, deliveries, top, routes] = await Promise.all([
    prisma.order.count({ where: { sellerCompanyId: me, status: "PENDING_CONFIRMATION" } }),
    prisma.order.count({ where: { sellerCompanyId: me, status: { not: "ON_HOLD" }, placedAt: { gte: today } } }),
    prisma.order.aggregate({ where: { sellerCompanyId: me, status: { notIn: ["CANCELLED", "ON_HOLD"] }, placedAt: { gte: since30 } }, _sum: { netTotal: true, vendorPayableNet: true }, _count: true }),
    prisma.order.aggregate({ where: { sellerCompanyId: me, status: { notIn: ["CANCELLED", "ON_HOLD"] }, placedAt: { gte: since60, lt: since30 } }, _sum: { netTotal: true, vendorPayableNet: true } }),
    // Orders FIRINGI holds for a check aren't the supplier's yet.
    dailySeries(Prisma.sql`"sellerCompanyId" = ${me} AND status <> 'ON_HOLD'`),
    latestOrders({ sellerCompanyId: me, status: { not: "ON_HOLD" } }, "buyer"),
    deliveriesToday({ executingCompanyId: me }),
    prisma.$queryRaw<{ name: Prisma.JsonValue; net: number }[]>`
      SELECT l."productName" AS name, sum(l."vendorLineNet")::float8 AS net FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
      WHERE o."sellerCompanyId" = ${me} AND o.status NOT IN ('CANCELLED', 'ON_HOLD') AND o."placedAt" >= ${since30}
      GROUP BY l."productName" ORDER BY net DESC LIMIT 5`,
    liveMapRoutes({ executingCompanyId: me }),
  ]);
  return {
    toConfirm, ordersToday, orders30: cur._count, payout30: Number(cur._sum.vendorPayableNet ?? 0), payoutPrev: Number(prev._sum.vendorPayableNet ?? 0),
    series, latest, deliveries, top, routes,
  };
}

/** Buyer dashboard: orders in progress, on the way today, spend, open invoices, most bought. */
export async function buyerLive(ctx: Ctx) {
  const me = ctx.company.id;
  const named = await (await import("@/server/catalogue/cart-help")).supplierNamer(ctx);
  const since30 = new Date(Date.now() - 30 * 86400_000), since60 = new Date(Date.now() - 60 * 86400_000);
  const [inProgress, onTheWay, cur, prev, series, latest, invoices, top] = await Promise.all([
    prisma.order.count({ where: { buyerCompanyId: me, status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED"] } } }),
    prisma.delivery.findMany({
      where: { order: { buyerCompanyId: me }, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] } },
      select: { id: true, eta: true, status: true, order: { select: { id: true, number: true, routedByFiringi: true, sellerCompanyId: true, seller: { select: { tradeName: true, legalName: true } } } } },
      orderBy: [{ eta: { sort: "asc", nulls: "last" } }], take: 6,
    }),
    prisma.order.aggregate({ where: { buyerCompanyId: me, status: { not: "CANCELLED" }, placedAt: { gte: since30 } }, _sum: { grandTotal: true }, _count: true }),
    prisma.order.aggregate({ where: { buyerCompanyId: me, status: { not: "CANCELLED" }, placedAt: { gte: since60, lt: since30 } }, _sum: { grandTotal: true } }),
    dailySeries(Prisma.sql`"buyerCompanyId" = ${me}`),
    latestOrders({ buyerCompanyId: me }, "seller", 14, named),
    creditStatuses([me]),
    prisma.$queryRaw<{ name: Prisma.JsonValue; net: number }[]>`
      SELECT l."productName" AS name, sum(l."lineNet")::float8 AS net FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
      WHERE o."buyerCompanyId" = ${me} AND o.status <> 'CANCELLED' AND o."placedAt" >= ${since30}
      GROUP BY l."productName" ORDER BY net DESC LIMIT 5`,
  ]);
  const open = invoices[0]?.openInvoices ?? 0;
  const overdue = invoices[0]?.overdue ?? 0;
  return {
    inProgress, onTheWay: onTheWay.map((d) => ({ ...d, supplier: d.order.routedByFiringi ? "FIRINGI" : named(d.order.sellerCompanyId, d.order.seller.tradeName ?? d.order.seller.legalName) })),
    spend30: Number(cur._sum.grandTotal ?? 0), spendPrev: Number(prev._sum.grandTotal ?? 0), orders30: cur._count, series, latest, openInvoices: open, overdue, top,
  };
}
