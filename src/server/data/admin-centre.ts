import "server-only";
/**
 * FIRINGI's admin dashboard, more information (Phase 59): sales against the same days last month, money (what
 * customers owe, what is overdue, supplier payouts due, cash received), the order pipeline, what needs action,
 * top suppliers / customers / products, sales by country and by channel, and platform health.
 * Every figure is a plain count or sum over the same records the detail pages use; each block links there.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can, requirePermission } from "@/server/rbac/guard";
import { pickLocalized } from "@/i18n/config";

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Change in percent (null when there is nothing to compare with). */
export const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

/** This month so far and the same number of days of last month (calendar months, server time). */
export function comparePeriods(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEndFull = monthStart;
  const elapsed = now.getTime() - monthStart.getTime();
  const lastSame = new Date(Math.min(lastStart.getTime() + elapsed, lastEndFull.getTime()));
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return { monthStart, lastStart, lastSame, today };
}

const OPEN_PIPELINE = ["NEW", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "ON_HOLD", "EXCEPTION"] as const;

export type ActionItem = { key: string; count: number; href: string; level: "neg" | "warn" | "info" };

export async function adminCentre(ctx: Ctx, now = new Date()) {
  requirePermission(ctx, "admin.dashboard.view");
  const { monthStart, lastStart, lastSame, today } = comparePeriods(now);
  const live = { status: { notIn: ["CANCELLED" as const] } };
  const [thisM, lastM, pipeline, deliveredToday, byCountryRaw, byChannelRaw, topSupRaw, topCusRaw, topProdRaw, spark] = await Promise.all([
    prisma.order.aggregate({ where: { ...live, placedAt: { gte: monthStart, lte: now } }, _sum: { netTotal: true, firingiMarginNet: true }, _count: { _all: true } }),
    prisma.order.aggregate({ where: { ...live, placedAt: { gte: lastStart, lt: lastSame } }, _sum: { netTotal: true, firingiMarginNet: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["status"], where: { status: { in: [...OPEN_PIPELINE] } }, _count: { _all: true } }),
    prisma.order.count({ where: { status: "DELIVERED", updatedAt: { gte: today } } }),
    prisma.order.groupBy({ by: ["countryId"], where: { ...live, placedAt: { gte: monthStart } }, _sum: { netTotal: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["placedVia"], where: { ...live, placedAt: { gte: monthStart } }, _sum: { netTotal: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["sellerCompanyId"], where: { ...live, placedAt: { gte: monthStart } }, _sum: { netTotal: true }, _count: { _all: true }, orderBy: { _sum: { netTotal: "desc" } }, take: 5 }),
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { ...live, placedAt: { gte: monthStart } }, _sum: { netTotal: true }, _count: { _all: true }, orderBy: { _sum: { netTotal: "desc" } }, take: 5 }),
    prisma.orderLine.groupBy({ by: ["offerId"], where: { order: { ...live, placedAt: { gte: monthStart } } }, _sum: { lineNet: true, qtyOrdered: true }, orderBy: { _sum: { lineNet: "desc" } }, take: 5 }),
    prisma.$queryRaw<{ d: Date; net: unknown }[]>`SELECT date_trunc('day', "placedAt") AS d, COALESCE(SUM("netTotal"), 0) AS net FROM "Order" WHERE "status" <> 'CANCELLED' AND "placedAt" >= ${monthStart} GROUP BY 1 ORDER BY 1`,
  ]);

  // names for the top lists and countries
  const companyIds = [...topSupRaw.map((r) => r.sellerCompanyId), ...topCusRaw.map((r) => r.buyerCompanyId)];
  const [companies, countries, offers] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true, flag: true } } } }),
    prisma.country.findMany({ where: { id: { in: byCountryRaw.map((r) => r.countryId) } }, select: { id: true, code: true, flag: true, name: true } }),
    prisma.vendorOffer.findMany({ where: { id: { in: topProdRaw.map((r) => r.offerId) } }, select: { id: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } }),
  ]);
  const co = new Map(companies.map((c) => [c.id, c]));
  const name = (c?: { legalName: string; tradeName: string | null }) => (c ? c.tradeName ?? c.legalName : "—");
  const loc = ctx.user.locale ?? "en";

  const salesNow = n(thisM._sum.netTotal), salesBefore = n(lastM._sum.netTotal);
  const marginNow = n(thisM._sum.firingiMarginNet), marginBefore = n(lastM._sum.firingiMarginNet);
  const ordersNow = thisM._count._all, ordersBefore = lastM._count._all;

  // ── money (only for people who may see finance) ──
  let money: null | { receivable: number; receivableCount: number; overdue: number; overdueCount: number; payoutsDue: number; payoutsOverdue: number; payoutCount: number; received: number; earlyPayouts: number } = null;
  if (can(ctx, ["admin.finance.view", "admin.finance.manage", "admin.invoices.view"])) {
    const { listSalesInvoices } = await import("@/server/services/finance");
    const unpaid = await listSalesInvoices(ctx, { as: "ADMIN", unpaidOnly: true }).catch(() => []);
    const receivable = unpaid.reduce((a, r) => a + Number(r.open), 0);
    const overdueRows = unpaid.filter((r) => r.overdue);
    let payoutsDue = 0, payoutsOverdue = 0, payoutCount = 0;
    if (can(ctx, ["admin.finance.view", "admin.finance.manage"])) {
      const { duePayouts } = await import("@/server/services/payouts");
      const p = await duePayouts(ctx, { withinDays: 7, now }).catch(() => null);
      if (p) { payoutsDue = p.totals.soon; payoutsOverdue = p.totals.overdue; payoutCount = p.overdue.length + p.soon.length; }
    }
    const [received, early] = await Promise.all([
      prisma.payment.aggregate({ where: { status: "CONFIRMED", paidAt: { gte: monthStart } }, _sum: { amount: true } }),
      prisma.earlyPayout.count({ where: { status: "REQUESTED" } }),
    ]);
    money = { receivable: r2(receivable), receivableCount: unpaid.length, overdue: r2(overdueRows.reduce((a, r) => a + Number(r.open), 0)), overdueCount: overdueRows.length, payoutsDue: r2(payoutsDue), payoutsOverdue: r2(payoutsOverdue), payoutCount, received: r2(n(received._sum.amount)), earlyPayouts: early };
  }

  // ── needs action: only what is waiting, each with the page that handles it ──
  const [supApps, cusApps, approvals, onHold, awaiting, exceptions, claims, priceReq, certs, food, tickets, early] = await Promise.all([
    prisma.company.count({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.company.count({ where: { type: "CUSTOMER", status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.approvalRequest.count({ where: { status: "PENDING" } }),
    prisma.order.count({ where: { status: "ON_HOLD" } }),
    prisma.order.count({ where: { status: "PENDING_CONFIRMATION" } }),
    prisma.orderException.count({ where: { isResolved: false } }),
    prisma.qualityClaim.count({ where: { status: "OPEN" } }),
    prisma.priceChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.certificate.count({ where: { status: "PENDING" } }),
    prisma.foodInfo.count({ where: { status: "PENDING" } }),
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    prisma.earlyPayout.count({ where: { status: "REQUESTED" } }),
  ]);
  const actions: ActionItem[] = ([
    { key: "exceptions", count: exceptions, href: "/admin/dashboard/alerts", level: "neg" },
    { key: "onHold", count: onHold, href: "/admin/risk/suspicious-orders", level: "neg" },
    { key: "overdue", count: money?.overdueCount ?? 0, href: "/admin/finance/receivable", level: "neg" },
    { key: "approvals", count: approvals, href: "/admin/users/approval-workflows", level: "warn" },
    { key: "awaiting", count: awaiting, href: "/admin/orders/pending-confirmation", level: "warn" },
    { key: "claims", count: claims, href: "/admin/orders/claims", level: "warn" },
    { key: "tickets", count: tickets, href: "/admin/customers/support", level: "warn" },
    { key: "supApps", count: supApps, href: "/admin/vendors/distributors/applications", level: "info" },
    { key: "cusApps", count: cusApps, href: "/admin/customers/applications", level: "info" },
    { key: "prices", count: priceReq, href: "/admin/pricing/intelligence/requests", level: "info" },
    { key: "certs", count: certs, href: "/admin/vendors/compliance/review", level: "info" },
    { key: "food", count: food, href: "/admin/catalogue/food-review", level: "info" },
    { key: "early", count: early, href: "/admin/vendors/plans/early-payouts", level: "info" },
  ] satisfies ActionItem[]).filter((a) => a.count > 0);

  // ── platform health ──
  let health: null | { status: "ok" | "warning" | "critical"; problems: { label: string; detail: string; state: string }[] } = null;
  if (can(ctx, ["admin.settings.view", "admin.settings.manage"])) {
    const { healthReport } = await import("@/server/ops/health");
    const h = await healthReport(now).catch(() => null);
    if (h) health = { status: h.status as "ok" | "warning" | "critical", problems: h.checks.filter((c) => c.state !== "ok").slice(0, 4).map((c) => ({ label: c.label, detail: String(c.detail ?? ""), state: c.state })) };
  }

  const pipeCount = (s: string) => pipeline.find((p) => p.status === s)?._count._all ?? 0;
  const totalCountry = byCountryRaw.reduce((a, r) => a + n(r._sum.netTotal), 0);
  const totalChannel = byChannelRaw.reduce((a, r) => a + r._count._all, 0);
  return {
    period: { from: monthStart.toISOString(), lastFrom: lastStart.toISOString(), lastTo: lastSame.toISOString() },
    sales: {
      net: r2(salesNow), netBefore: r2(salesBefore), netChange: pctChange(salesNow, salesBefore),
      orders: ordersNow, ordersBefore, ordersChange: pctChange(ordersNow, ordersBefore),
      margin: r2(marginNow), marginBefore: r2(marginBefore), marginChange: pctChange(marginNow, marginBefore),
      marginPct: salesNow > 0 ? Math.round((marginNow / salesNow) * 1000) / 10 : null,
      avgOrder: ordersNow ? r2(salesNow / ordersNow) : 0, avgOrderBefore: ordersBefore ? r2(salesBefore / ordersBefore) : 0,
      daily: spark.map((d) => ({ day: new Date(d.d).toISOString().slice(0, 10), net: r2(n(d.net)) })),
    },
    money,
    pipeline: { steps: OPEN_PIPELINE.map((s) => ({ status: s, count: pipeCount(s) })), deliveredToday },
    actions,
    topSuppliers: topSupRaw.map((r) => { const c = co.get(r.sellerCompanyId); return { id: r.sellerCompanyId, name: name(c), type: c?.type ?? "", flag: c?.country.flag ?? "", net: r2(n(r._sum.netTotal)), orders: r._count._all }; }),
    topCustomers: topCusRaw.map((r) => { const c = co.get(r.buyerCompanyId); return { id: r.buyerCompanyId, name: name(c), type: c?.type ?? "", flag: c?.country.flag ?? "", net: r2(n(r._sum.netTotal)), orders: r._count._all }; }),
    topProducts: topProdRaw.map((r) => { const o = offers.find((x) => x.id === r.offerId); return { offerId: r.offerId, name: o ? pickLocalized(o.packaging.variant.product.name as Record<string, string>, loc) : "—", pack: o ? pickLocalized(o.packaging.name as Record<string, string>, loc) : "", sku: o?.packaging.variant.sku ?? "", supplier: name(o?.vendor), qty: n(r._sum.qtyOrdered), net: r2(n(r._sum.lineNet)) }; }),
    byCountry: byCountryRaw.map((r) => { const c = countries.find((x) => x.id === r.countryId); return { code: c?.code ?? "?", flag: c?.flag ?? "", name: c ? pickLocalized(c.name as Record<string, string>, loc) || c.code : "?", net: r2(n(r._sum.netTotal)), orders: r._count._all, share: totalCountry ? Math.round((n(r._sum.netTotal) / totalCountry) * 1000) / 10 : 0 }; }).sort((a, b) => b.net - a.net),
    byChannel: byChannelRaw.map((r) => ({ channel: r.placedVia, orders: r._count._all, net: r2(n(r._sum.netTotal)), share: totalChannel ? Math.round((r._count._all / totalChannel) * 1000) / 10 : 0 })).sort((a, b) => b.orders - a.orders),
    health,
  };
}

export type AdminCentre = Awaited<ReturnType<typeof adminCentre>>;
