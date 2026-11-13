/**
 * Fleet numbers for dispatchers: the live operations board, delivery performance (on time vs.
 * the ETA the customer was given), driver performance and FIRINGI drivers' earnings.
 * "On time" = delivered no later than the planned arrival + half the customer's ETA window.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { routingSettings } from "./routes";

function assertStats(ctx: Ctx) {
  if (ctx.company.type === "ADMIN" ? !can(ctx, ["admin.delivery.view", "admin.delivery.manage", "admin.fleet.view", "admin.analytics.view"]) : !can(ctx, ["vendor.orders.manage", "vendor.fleet.view"])) throw new ForbiddenError();
}

export type Period = { from: Date; to: Date };
export function periodFrom(sp: { from?: string; to?: string }, days = 30): Period {
  const to = sp.to && !Number.isNaN(Date.parse(sp.to)) ? new Date(`${sp.to}T23:59:59.999Z`) : new Date();
  const from = sp.from && !Number.isNaN(Date.parse(sp.from)) ? new Date(`${sp.from}T00:00:00Z`) : new Date(to.getTime() - days * 86400_000);
  return { from, to };
}

/** FIRINGI sees its own fleet by default, or every fleet (`all`); vendors see their own. */
const fleetWhere = (ctx: Ctx, all?: boolean) => (ctx.company.type === "ADMIN" && all ? {} : { executingCompanyId: ctx.company.id });

// ── live board ──────────────────────────────────────────────────────────────

export async function liveBoard(ctx: Ctx, all = false) {
  assertStats(ctx);
  const settings = await routingSettings();
  const where = fleetWhere(ctx, all);
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const [routes, waiting, drivers, failedToday, deliveredToday, exceptions] = await Promise.all([
    prisma.route.findMany({
      where: { ...where, OR: [{ status: { in: ["PLANNED", "IN_PROGRESS"] } }, { status: "COMPLETED", completedAt: { gte: today } }] },
      include: {
        driver: { select: { availability: true, user: { select: { name: true, phone: true } } } }, vehicle: { select: { plate: true } },
        executor: { select: { tradeName: true, legalName: true } },
        stops: { orderBy: { sequence: "asc" }, select: { id: true, kind: true, label: true, doneAt: true, eta: true, plannedArrival: true, delivery: { select: { status: true, order: { select: { number: true } } } } } },
      },
      orderBy: [{ status: "asc" }, { plannedStartAt: "asc" }],
    }),
    prisma.delivery.count({ where: { ...where, mode: { not: "CARRIER" }, status: { in: ["UNASSIGNED", "ASSIGNED"] }, routeId: null, order: { status: { in: ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP"] } } } }),
    prisma.driver.findMany({ where: { ...(ctx.company.type === "ADMIN" && all ? {} : { ownerCompanyId: ctx.company.id }), status: "APPROVED" }, select: { availability: true } }),
    prisma.delivery.count({ where: { ...where, status: "FAILED" } }),
    prisma.delivery.count({ where: { ...where, status: "DELIVERED", completedAt: { gte: today } } }),
    prisma.orderException.count({ where: { isResolved: false, order: { delivery: where } } }),
  ]);
  const lateMs = (settings.etaWindowMinutes / 2) * 60_000;
  const rows = routes.map((r) => {
    const next = r.stops.find((s) => !s.doneAt);
    const late = r.stops.filter((s) => !s.doneAt && s.eta && s.plannedArrival && s.eta.getTime() - s.plannedArrival.getTime() > lateMs).length;
    return {
      id: r.id, number: r.number, status: r.status, driver: r.driver?.user.name ?? "—", phone: r.driver?.user.phone ?? null, vehicle: r.vehicle?.plate ?? null,
      executor: r.executor.tradeName ?? r.executor.legalName, plannedStartAt: r.plannedStartAt, startedAt: r.startedAt,
      done: r.stops.filter((s) => s.doneAt).length, total: r.stops.length, late,
      next: next ? { kind: next.kind, label: next.label, order: next.delivery.order.number, eta: next.eta } : null,
      finishEta: r.stops.length ? r.stops[r.stops.length - 1].eta : null,
    };
  });
  const count = (a: string) => drivers.filter((d) => d.availability === a).length;
  return {
    rows,
    kpi: {
      running: rows.filter((r) => r.status === "IN_PROGRESS").length, planned: rows.filter((r) => r.status === "PLANNED").length,
      completedToday: rows.filter((r) => r.status === "COMPLETED").length, waiting, deliveredToday, failed: failedToday, exceptions,
      lateStops: rows.reduce((a, r) => a + r.late, 0),
      drivers: { available: count("AVAILABLE"), busy: count("BUSY"), off: count("OFF_DUTY") },
    },
  };
}

// ── delivery performance ────────────────────────────────────────────────────

type DoneDelivery = Prisma.DeliveryGetPayload<{ select: typeof doneSelect }>;
const doneSelect = {
  id: true, status: true, completedAt: true, assignedAt: true, pickedUpAt: true, routeId: true, driverId: true,
  stops: { where: { kind: "DROP" }, select: { plannedArrival: true, doneAt: true } },
  attempts: { select: { succeeded: true, reasonCode: true } },
  order: { select: { placedAt: true, number: true } },
} satisfies Prisma.DeliverySelect;

async function doneDeliveries(ctx: Ctx, p: Period, all?: boolean) {
  return prisma.delivery.findMany({
    where: { ...fleetWhere(ctx, all), mode: { not: "CARRIER" }, OR: [{ completedAt: { gte: p.from, lte: p.to } }, { status: "FAILED", updatedAt: { gte: p.from, lte: p.to } }] },
    select: doneSelect,
  });
}

function onTime(d: DoneDelivery, lateMs: number) {
  const s = d.stops[0];
  if (d.status !== "DELIVERED" || !s?.plannedArrival || !d.completedAt) return null;
  return d.completedAt.getTime() <= s.plannedArrival.getTime() + lateMs;
}

export async function deliveryPerformance(ctx: Ctx, p: Period, all = false) {
  assertStats(ctx);
  const settings = await routingSettings();
  const lateMs = (settings.etaWindowMinutes / 2) * 60_000;
  const rows = await doneDeliveries(ctx, p, all);
  const delivered = rows.filter((d) => d.status === "DELIVERED");
  const timed = delivered.map((d) => onTime(d, lateMs)).filter((x): x is boolean => x !== null);
  const firstTry = delivered.filter((d) => d.attempts.filter((a) => !a.succeeded).length === 0).length;
  const hours = delivered.filter((d) => d.order.placedAt && d.completedAt).map((d) => (d.completedAt!.getTime() - d.order.placedAt!.getTime()) / 3600_000);
  const delays = delivered.filter((d) => d.stops[0]?.plannedArrival && d.completedAt).map((d) => (d.completedAt!.getTime() - d.stops[0].plannedArrival!.getTime()) / 60_000);
  const reasons = new Map<string, number>();
  for (const d of rows) for (const a of d.attempts) if (!a.succeeded) reasons.set(a.reasonCode ?? "OTHER", (reasons.get(a.reasonCode ?? "OTHER") ?? 0) + 1);
  // by day
  const days = new Map<string, { delivered: number; failed: number; onTime: number; timed: number }>();
  for (const d of rows) {
    const day = (d.completedAt ?? new Date()).toISOString().slice(0, 10);
    const x = days.get(day) ?? { delivered: 0, failed: 0, onTime: 0, timed: 0 };
    if (d.status === "DELIVERED") x.delivered++; else if (d.status === "FAILED" || d.status === "RETURNED") x.failed++;
    const t = onTime(d, lateMs);
    if (t !== null) { x.timed++; if (t) x.onTime++; }
    days.set(day, x);
  }
  const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return {
    delivered: delivered.length, failed: rows.filter((d) => d.status === "FAILED" || d.status === "RETURNED").length,
    onTimeRate: timed.length ? timed.filter(Boolean).length / timed.length : null, timed: timed.length,
    firstTryRate: delivered.length ? firstTry / delivered.length : null,
    onRoute: delivered.filter((d) => d.routeId || d.stops.length).length,
    medianLeadHours: median(hours), medianDelayMinutes: median(delays),
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
    days: [...days.entries()].sort().map(([day, v]) => ({ day, ...v })),
  };
}

// ── drivers ─────────────────────────────────────────────────────────────────

export async function driverPerformance(ctx: Ctx, p: Period, all = false) {
  assertStats(ctx);
  const settings = await routingSettings();
  const lateMs = (settings.etaWindowMinutes / 2) * 60_000;
  const [drivers, rows, routes] = await Promise.all([
    prisma.driver.findMany({
      where: { ...(ctx.company.type === "ADMIN" && all ? {} : { ownerCompanyId: ctx.company.id }), status: { in: ["APPROVED", "SUSPENDED"] } },
      select: { id: true, status: true, availability: true, user: { select: { name: true } }, owner: { select: { tradeName: true, legalName: true, type: true } } },
    }),
    doneDeliveries(ctx, p, all),
    prisma.route.findMany({ where: { ...fleetWhere(ctx, all), status: { in: ["COMPLETED", "IN_PROGRESS"] }, date: { gte: new Date(p.from.toISOString().slice(0, 10)), lte: p.to } }, select: { driverId: true, plannedKm: true, plannedMinutes: true, startedAt: true, completedAt: true } }),
  ]);
  return drivers.map((dr) => {
    const mine = rows.filter((d) => d.driverId === dr.id);
    const delivered = mine.filter((d) => d.status === "DELIVERED");
    const timed = delivered.map((d) => onTime(d, lateMs)).filter((x): x is boolean => x !== null);
    const rs = routes.filter((r) => r.driverId === dr.id);
    const worked = rs.filter((r) => r.startedAt && r.completedAt).reduce((a, r) => a + (r.completedAt!.getTime() - r.startedAt!.getTime()) / 3600_000, 0);
    return {
      id: dr.id, name: dr.user.name, status: dr.status, availability: dr.availability, fleet: dr.owner.tradeName ?? dr.owner.legalName, firingi: dr.owner.type === "ADMIN",
      routes: rs.length, delivered: delivered.length, failed: mine.filter((d) => d.status === "FAILED" || d.status === "RETURNED").length,
      onTimeRate: timed.length ? timed.filter(Boolean).length / timed.length : null,
      successRate: mine.length ? delivered.length / mine.length : null,
      km: rs.reduce((a, r) => a + Number(r.plannedKm), 0), hours: worked,
      perHour: worked > 0 ? delivered.length / worked : null,
    };
  }).sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name));
}

/** FIRINGI drivers' pay for the period: per completed route + per delivered order the customer paid delivery for + per planned km, less quality-claim charge-backs. */
export async function driverEarnings(ctx: Ctx, p: Period) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.finance.view"])) throw new ForbiddenError();
  const { pay } = await routingSettings();
  const perf = await driverPerformance(ctx, p);
  const completed = await prisma.route.groupBy({ by: ["driverId"], where: { executingCompanyId: ctx.company.id, status: "COMPLETED", completedAt: { gte: p.from, lte: p.to } }, _count: { _all: true }, _sum: { plannedKm: true } });
  const byDriver = new Map(completed.map((c) => [c.driverId, c]));
  // Per-delivery pay only where the customer paid for delivery (fee or flat rate) — free deliveries earn route + km pay only.
  const paid = await prisma.delivery.groupBy({ by: ["driverId"], where: { executingCompanyId: ctx.company.id, status: "DELIVERED", completedAt: { gte: p.from, lte: p.to }, order: { deliveryFeeNet: { gt: 0 } } }, _count: { _all: true } });
  const paidBy = new Map(paid.map((x) => [x.driverId, x._count._all]));
  // Quality-claim charge-backs raised in the period (open = still to deduct).
  const cbs = await prisma.claimChargeback.groupBy({ by: ["driverId", "status"], where: { target: "DRIVER", status: { in: ["OPEN", "DEDUCTED"] }, createdAt: { gte: p.from, lte: p.to } }, _sum: { amount: true } });
  const ded = new Map<string, { open: number; done: number }>();
  for (const c of cbs) { const e = ded.get(c.driverId!) ?? { open: 0, done: 0 }; if (c.status === "OPEN") e.open += Number(c._sum.amount ?? 0); else e.done += Number(c._sum.amount ?? 0); ded.set(c.driverId!, e); }
  const rows = perf.map((d) => {
    const c = byDriver.get(d.id);
    const routes = c?._count._all ?? 0, km = Number(c?._sum.plannedKm ?? 0), feePaid = paidBy.get(d.id) ?? 0;
    const routePay = routes * pay.perRoute, deliveryPay = feePaid * pay.perDelivery, kmPay = km * pay.perKm;
    const gross = routePay + deliveryPay + kmPay, dd = ded.get(d.id) ?? { open: 0, done: 0 }, deductions = Math.round((dd.open + dd.done) * 100) / 100;
    return { id: d.id, name: d.name, routes, delivered: d.delivered, feePaid, km, routePay, deliveryPay, kmPay, gross, deductions, openDeductions: Math.round(dd.open * 100) / 100, total: Math.round((gross - deductions) * 100) / 100 };
  });
  return { pay, rows, total: rows.reduce((a, r) => a + r.total, 0) };
}
