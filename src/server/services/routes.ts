/**
 * Routes: one driver's multi-stop run on one day (FIRINGI's fleet, or a vendor's own fleet).
 *   • Plan: pick deliveries (or auto-plan the day) → stops are ordered by the optimiser
 *     (collect at the suppliers' pickup points before dropping at the customers) with an ETA
 *     for every stop; the deliveries are assigned to the route's driver and vehicle.
 *   • Run: the driver starts the route (customers get their ETA window); each pickup / delivery
 *     the driver records (the existing delivery steps) ticks its stop and moves the ETAs of the
 *     remaining stops; the route completes when every stop is done.
 * The multi-order limit of the fleet (Delivery Settings) caps the deliveries per driver.
 */
import type { Prisma, RouteStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { nextNumber } from "./orders";
import { ordersPerDriver } from "./delivery-settings";
import { writeAudit } from "./audit";
import { notify } from "@/server/notify/dispatch";
import { arrivals, isValidOrder, optimiseOrder, routeKm, routeMinutes, sweepGroups, type LatLng, type PlanStop, type RoutingParams } from "@/server/delivery/routing";

// ── settings ────────────────────────────────────────────────────────────────

const KEY = "routing.settings";
export type RoutingSettings = RoutingParams & {
  /** Planned start of a route (local time, HH:MM). */
  startTime: string;
  /** FIRINGI's depot (address id of FIRINGI / its in-house warehouse); null = first warehouse. */
  depotAddressId: string | null;
  /** Width of the delivery window shown to customers, around the ETA. */
  etaWindowMinutes: number;
  /** FIRINGI drivers' pay: per route, per delivered order, per planned km. */
  pay: { perRoute: number; perDelivery: number; perKm: number };
};
export const DEFAULT_ROUTING: RoutingSettings = {
  avgSpeedKmh: 30, roadFactor: 1.3, pickupMinutes: 5, dropMinutes: 8, startTime: "08:00", depotAddressId: null, etaWindowMinutes: 60,
  pay: { perRoute: 15, perDelivery: 3.5, perKm: 0.25 },
};

export async function routingSettings(): Promise<RoutingSettings> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  const v = (s?.value ?? {}) as Partial<RoutingSettings>;
  return { ...DEFAULT_ROUTING, ...v, pay: { ...DEFAULT_ROUTING.pay, ...(v.pay ?? {}) } };
}

export async function setRoutingSettings(ctx: Ctx, patch: Partial<RoutingSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.delivery.manage", "admin.settings.manage"])) throw new ForbiddenError();
  const before = await routingSettings();
  const n = { ...before, ...patch, pay: { ...before.pay, ...(patch.pay ?? {}) } };
  const num = (v: unknown, lo: number, hi: number, label: string) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw new ValidationError(`${label} must be ${lo}–${hi}.`); return x; };
  n.avgSpeedKmh = num(n.avgSpeedKmh, 5, 120, "Average speed (km/h)");
  n.roadFactor = num(n.roadFactor, 1, 3, "Road factor");
  n.pickupMinutes = num(n.pickupMinutes, 0, 120, "Pickup time (minutes)");
  n.dropMinutes = num(n.dropMinutes, 0, 120, "Drop time (minutes)");
  n.etaWindowMinutes = num(n.etaWindowMinutes, 15, 240, "ETA window (minutes)");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(n.startTime)) throw new ValidationError("Start time must be HH:MM.");
  n.pay = { perRoute: num(n.pay.perRoute, 0, 1000, "Pay per route"), perDelivery: num(n.pay.perDelivery, 0, 1000, "Pay per delivery"), perKm: num(n.pay.perKm, 0, 100, "Pay per km") };
  if (n.depotAddressId) {
    const a = await prisma.address.findFirst({ where: { id: n.depotAddressId, isActive: true, company: { OR: [{ type: "ADMIN" }, { isInHouse: true }] } } });
    if (!a) throw new ValidationError("Choose one of FIRINGI's addresses as depot.");
  }
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } }, update: { value: n, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: KEY, value: n, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "setting.routing", entityType: "Setting", entityId: KEY, before, after: n });
  return n;
}

// ── access ──────────────────────────────────────────────────────────────────

const ADMIN_PERMS = ["admin.delivery.manage"] as const;
const VENDOR_PERMS = ["vendor.orders.manage", "vendor.drivers.manage"] as const;
/** Dispatcher of its own fleet: FIRINGI (delivery managers) or a vendor (order / driver managers). */
export function assertDispatcher(ctx: Ctx) {
  if (ctx.company.type === "ADMIN" ? !can(ctx, [...ADMIN_PERMS]) : !can(ctx, [...VENDOR_PERMS])) throw new ForbiddenError();
}
function assertViewer(ctx: Ctx) {
  if (ctx.company.type === "ADMIN" ? !can(ctx, ["admin.delivery.view", "admin.delivery.manage", "admin.fleet.view"]) : !can(ctx, ["vendor.orders.view", "vendor.orders.manage", "vendor.fleet.view"])) throw new ForbiddenError();
}

const n = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? null : Number(d));
const point = (lat: unknown, lng: unknown): LatLng | null => (lat !== null && lat !== undefined && lng !== null && lng !== undefined ? { lat: Number(lat), lng: Number(lng) } : null);
const OPEN_ROUTE: RouteStatus[] = ["PLANNED", "IN_PROGRESS"];

/** Start point of this company's routes: the configured depot (FIRINGI) or its first warehouse. */
async function depotFor(companyId: string, isFiringi: boolean) {
  const s = await routingSettings();
  const a = (isFiringi && s.depotAddressId ? await prisma.address.findUnique({ where: { id: s.depotAddressId } }) : null)
    ?? (await prisma.address.findFirst({ where: { companyId, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, orderBy: { kind: "desc" } }))
    ?? (isFiringi ? await prisma.address.findFirst({ where: { isActive: true, kind: "WAREHOUSE", company: { isInHouse: true } } }) : null)
    ?? (await prisma.address.findFirst({ where: { companyId, isActive: true, kind: "HEAD_OFFICE" } }));
  return a ? { label: a.label, at: point(a.latitude, a.longitude) } : { label: null as string | null, at: null as LatLng | null };
}

/** Local start time of a route on `date` (Europe/Lisbon ≈ UTC in winter; good enough for planning). */
function plannedStart(date: Date, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m));
  return d < new Date() ? new Date(Math.ceil(Date.now() / 300_000) * 300_000) : d; // today, later than planned → now
}

const plannableWhere = (companyId: string): Prisma.DeliveryWhereInput => ({
  executingCompanyId: companyId,
  mode: { not: "CARRIER" },
  status: { in: ["UNASSIGNED", "ASSIGNED"] },
  order: { status: { in: ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP"] } },
  OR: [{ routeId: null }, { route: { status: { in: ["COMPLETED", "CANCELLED"] } } }],
});

const plannableInclude = {
  order: {
    select: {
      id: true, number: true, status: true, deliveryAddress: true, requestedDeliveryDate: true, sellerCompanyId: true,
      buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { id: true, legalName: true, tradeName: true } },
      sourceAddress: { select: { label: true, line1: true, postalCode: true, cityName: true, latitude: true, longitude: true } },
    },
  },
} satisfies Prisma.DeliveryInclude;
type Plannable = Prisma.DeliveryGetPayload<{ include: typeof plannableInclude }>;

/** Deliveries this company may put on a route. */
export async function plannableDeliveries(ctx: Ctx) {
  assertDispatcher(ctx);
  const rows = await prisma.delivery.findMany({ where: plannableWhere(ctx.company.id), include: plannableInclude, orderBy: { createdAt: "asc" }, take: 500 });
  const regionIds = [...new Set(rows.map((r) => (r.order.deliveryAddress as { regionId?: string | null }).regionId).filter(Boolean) as string[])];
  const regions = new Map((await prisma.region.findMany({ where: { id: { in: regionIds } }, select: { id: true, name: true } })).map((r) => [r.id, (r.name as Record<string, string>).pt ?? (r.name as Record<string, string>).en]));
  return rows.map((d) => {
    const a = d.order.deliveryAddress as { city?: string; regionId?: string | null; line1?: string };
    return {
      id: d.id, orderId: d.order.id, number: d.order.number, status: d.status, orderStatus: d.order.status,
      buyer: d.order.buyer.tradeName ?? d.order.buyer.legalName, supplier: d.order.seller.tradeName ?? d.order.seller.legalName,
      pickup: d.order.sourceAddress ? `${d.order.sourceAddress.label} · ${d.order.sourceAddress.cityName}` : "—",
      city: a.city ?? "—", region: (a.regionId && regions.get(a.regionId)) || "—", requested: d.order.requestedDeliveryDate,
    };
  });
}

/** Pickup and drop stops for deliveries (pickup only while the goods are still at the supplier). */
async function stopsFor(deliveries: Plannable[]): Promise<(PlanStop & { label: string; address: string })[]> {
  const out: (PlanStop & { label: string; address: string })[] = [];
  for (const d of deliveries) {
    const src = d.order.sourceAddress ?? (await prisma.address.findFirst({ where: { companyId: d.order.sellerCompanyId, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } } }));
    const dst = d.order.deliveryAddress as { line1?: string; postalCode?: string; city?: string; latitude?: string | null; longitude?: string | null };
    if (!d.pickedUpAt)
      out.push({ key: `${d.id}:PICKUP`, deliveryId: d.id, kind: "PICKUP", at: src ? point(src.latitude, src.longitude) : null, label: d.order.seller.tradeName ?? d.order.seller.legalName, address: src ? `${src.line1}, ${src.postalCode} ${src.cityName}` : "—" });
    out.push({ key: `${d.id}:DROP`, deliveryId: d.id, kind: "DROP", at: point(dst.latitude, dst.longitude), label: d.order.buyer.tradeName ?? d.order.buyer.legalName, address: `${dst.line1 ?? ""}, ${dst.postalCode ?? ""} ${dst.city ?? ""}` });
  }
  return out;
}

// ── planning ────────────────────────────────────────────────────────────────

async function checkDriver(companyId: string, driverId: string, vehicleId: string | null) {
  const driver = await prisma.driver.findFirst({ where: { id: driverId, ownerCompanyId: companyId, status: "APPROVED" }, include: { user: { select: { id: true, name: true } } } });
  if (!driver) throw new ValidationError("Choose an approved driver of your fleet.");
  if (vehicleId && !(await prisma.vehicle.findFirst({ where: { id: vehicleId, ownerCompanyId: companyId, status: "ACTIVE" } }))) throw new ValidationError("Choose an active vehicle of your fleet.");
  return driver;
}

export async function createRoute(ctx: Ctx, input: { date: Date; driverId: string; vehicleId?: string | null; deliveryIds: string[] }) {
  assertDispatcher(ctx);
  const ids = [...new Set(input.deliveryIds)];
  if (!ids.length) throw new ValidationError("Choose at least one delivery.");
  const driver = await checkDriver(ctx.company.id, input.driverId, input.vehicleId ?? null);
  const deliveries = await prisma.delivery.findMany({ where: { AND: [plannableWhere(ctx.company.id), { id: { in: ids } }] }, include: plannableInclude });
  if (deliveries.length !== ids.length) throw new ValidationError("Some deliveries can't be planned any more (already on a route, picked up or cancelled). Reload and try again.");
  const isFiringi = ctx.company.type === "ADMIN";
  const limit = await ordersPerDriver(ctx.company.id, isFiringi);
  const otherOpen = await prisma.delivery.count({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { notIn: ids } } });
  if (otherOpen + ids.length > limit)
    throw new AppError("DRIVER_FULL", limit === 1 ? "Multi-order delivery is off for this fleet: one order per driver (Delivery Settings)." : `A driver may carry at most ${limit} orders (Delivery Settings); this driver already has ${otherOpen}.`, 409);
  const settings = await routingSettings();
  const depot = await depotFor(ctx.company.id, isFiringi);
  const stops = optimiseOrder(depot.at, await stopsFor(deliveries), settings) as (PlanStop & { label: string; address: string })[];
  const startAt = plannedStart(input.date, settings.startTime);
  const times = new Map(arrivals(depot.at, startAt, stops, settings).map((a) => [a.key, a.at]));
  const route = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "route", "RT");
    const r = await tx.route.create({
      data: {
        number, executingCompanyId: ctx.company.id, driverId: driver.id, vehicleId: input.vehicleId ?? null,
        date: new Date(Date.UTC(input.date.getUTCFullYear(), input.date.getUTCMonth(), input.date.getUTCDate())),
        startLabel: depot.label, startLat: depot.at?.lat ?? null, startLng: depot.at?.lng ?? null, plannedStartAt: startAt,
        plannedKm: routeKm(depot.at, stops, settings).toFixed(2), plannedMinutes: routeMinutes(depot.at, stops, settings), createdById: ctx.user.id,
        stops: {
          create: stops.map((s, i) => ({
            deliveryId: s.deliveryId, kind: s.kind, sequence: i + 1, label: s.label, address: s.address,
            lat: s.at?.lat ?? null, lng: s.at?.lng ?? null, plannedArrival: times.get(s.key), eta: times.get(s.key),
          })),
        },
      },
    });
    for (const d of deliveries)
      await tx.delivery.update({
        where: { id: d.id },
        data: {
          routeId: r.id, driverId: driver.id, vehicleId: input.vehicleId ?? d.vehicleId, status: d.status === "UNASSIGNED" ? "ASSIGNED" : d.status,
          assignedAt: d.assignedAt ?? new Date(), assignedById: ctx.user.id, scheduledFor: startAt, eta: times.get(`${d.id}:DROP`) ?? null,
        },
      });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "route.created", entityType: "Route", entityId: r.id, after: { number, driverId: driver.id, deliveries: ids.length } }, tx);
    return r;
  });
  await notify("route.assigned", [{ userId: driver.user.id, link: "/driver/deliveries/today" }], { number: route.number, stops: String(deliveries.length), date: route.date.toISOString().slice(0, 10) }, { ref: { type: "Route", id: route.id } });
  return route;
}

/** Plan the day automatically: unplanned deliveries split by direction over free drivers. */
export async function autoPlan(ctx: Ctx, date: Date) {
  assertDispatcher(ctx);
  const isFiringi = ctx.company.type === "ADMIN";
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const busy = new Set((await prisma.route.findMany({ where: { executingCompanyId: ctx.company.id, date: dayStart, status: { in: OPEN_ROUTE } }, select: { driverId: true } })).map((r) => r.driverId));
  const drivers = (await prisma.driver.findMany({ where: { ownerCompanyId: ctx.company.id, status: "APPROVED", availability: { not: "OFF_DUTY" } }, orderBy: { createdAt: "asc" } }))
    .filter((d) => !busy.has(d.id));
  if (!drivers.length) throw new ValidationError("No free driver for this day (approved, on duty, without a route).");
  const items = (await prisma.delivery.findMany({ where: plannableWhere(ctx.company.id), include: plannableInclude, take: 500 }))
    .filter((d) => !d.order.requestedDeliveryDate || d.order.requestedDeliveryDate <= new Date(dayStart.getTime() + 86400_000));
  if (!items.length) throw new ValidationError("Nothing to plan: no confirmed deliveries waiting for a route.");
  const limit = await ordersPerDriver(ctx.company.id, isFiringi);
  const depot = await depotFor(ctx.company.id, isFiringi);
  // More work than drivers can carry: the longest-waiting deliveries go first.
  const due = (d: Plannable) => (d.order.requestedDeliveryDate ?? d.createdAt).getTime();
  const take = [...items].sort((a, b) => due(a) - due(b)).slice(0, drivers.length * limit);
  const groups = sweepGroups(depot.at, take.map((d) => ({ id: d.id, drop: point((d.order.deliveryAddress as { latitude?: string }).latitude, (d.order.deliveryAddress as { longitude?: string }).longitude) })), drivers.length, limit);
  const vehicles = await prisma.vehicle.findMany({ where: { ownerCompanyId: ctx.company.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  const created = [];
  for (const [i, g] of groups.entries())
    created.push(await createRoute(ctx, { date: dayStart, driverId: drivers[i].id, vehicleId: vehicles[i]?.id ?? null, deliveryIds: g.map((x) => x.id) }));
  const planned = groups.reduce((a, g) => a + g.length, 0);
  return { routes: created.map((r) => ({ id: r.id, number: r.number })), planned, left: items.length - planned };
}

// ── changes while planned / running ─────────────────────────────────────────

/**
 * Take a delivery off its route inside a transaction (handed to another driver, order cancelled):
 * its open stops go, the route is re-timed — or closed when nothing is left.
 */
export async function detachFromRoute(tx: Tx, deliveryId: string) {
  const d = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { routeId: true } });
  if (!d?.routeId) return;
  const routeId = d.routeId;
  await tx.routeStop.deleteMany({ where: { routeId, deliveryId, doneAt: null } });
  await tx.delivery.update({ where: { id: deliveryId }, data: { routeId: null, eta: null } });
  const left = await tx.routeStop.count({ where: { routeId, doneAt: null } });
  if (left) return refreshRoute(tx, routeId);
  const any = await tx.routeStop.count({ where: { routeId } });
  await tx.route.update({ where: { id: routeId }, data: any ? { status: "COMPLETED", completedAt: new Date() } : { status: "CANCELLED" } });
}

async function loadRoute(ctx: Ctx, id: string, manage = true) {
  if (manage) assertDispatcher(ctx); else assertViewer(ctx);
  const r = await prisma.route.findUnique({ where: { id }, include: { stops: { orderBy: { sequence: "asc" }, include: { delivery: { select: { id: true, status: true, pickedUpAt: true, completedAt: true, orderId: true } } } } } });
  if (!r || (ctx.company.type !== "ADMIN" && r.executingCompanyId !== ctx.company.id) || (manage && r.executingCompanyId !== ctx.company.id)) throw new NotFoundError("Route");
  return r;
}

/** Recompute ETAs (from `from`, default now or the planned start) and km / minutes. */
export async function refreshRoute(tx: Tx, routeId: string, opts: { reorder?: boolean } = {}) {
  const r = await tx.route.findUniqueOrThrow({ where: { id: routeId }, include: { stops: { orderBy: { sequence: "asc" } } } });
  const settings = await routingSettings();
  const start = point(r.startLat, r.startLng);
  let stops = r.stops.map((s) => ({ key: s.id, deliveryId: s.deliveryId, kind: s.kind, at: point(s.lat, s.lng), doneAt: s.doneAt }));
  if (opts.reorder) {
    const done = stops.filter((s) => s.doneAt);
    const lastDone = done.length ? done[done.length - 1].at ?? start : start;
    const rest = optimiseOrder(lastDone, stops.filter((s) => !s.doneAt), settings);
    stops = [...done, ...rest.map((x) => stops.find((s) => s.key === x.key)!)];
  }
  const from = r.status === "IN_PROGRESS" ? new Date() : r.plannedStartAt;
  const lastDone = [...stops].reverse().find((s) => s.doneAt);
  const startAt = lastDone?.doneAt && lastDone.doneAt > from ? lastDone.doneAt : from;
  const times = new Map(arrivals(start, startAt, stops, settings).map((a) => [a.key, a.at]));
  for (const [i, s] of stops.entries())
    await tx.routeStop.update({ where: { id: s.key }, data: { sequence: i + 1, ...(s.doneAt ? {} : { eta: times.get(s.key), ...(r.status === "PLANNED" ? { plannedArrival: times.get(s.key) } : {}) }) } });
  if (r.status === "PLANNED") await tx.route.update({ where: { id: routeId }, data: { plannedKm: routeKm(start, stops, settings).toFixed(2), plannedMinutes: routeMinutes(start, stops, settings) } });
  for (const s of stops.filter((x) => x.kind === "DROP" && !x.doneAt)) await tx.delivery.update({ where: { id: s.deliveryId }, data: { eta: times.get(s.key) } });
}

export async function reoptimiseRoute(ctx: Ctx, id: string) {
  const r = await loadRoute(ctx, id);
  if (!OPEN_ROUTE.includes(r.status)) throw new ValidationError("Only planned or running routes can be re-optimised.");
  const before = Number(r.plannedKm);
  await prisma.$transaction((tx) => refreshRoute(tx, id, { reorder: true }));
  const after = await prisma.route.findUniqueOrThrow({ where: { id }, select: { plannedKm: true } });
  return { beforeKm: before, afterKm: Number(after.plannedKm) };
}

/** Move a stop one place up or down (pickup must stay before its drop). */
export async function moveStop(ctx: Ctx, routeId: string, stopId: string, dir: -1 | 1) {
  const r = await loadRoute(ctx, routeId);
  if (!OPEN_ROUTE.includes(r.status)) throw new ValidationError("This route can't be changed.");
  const i = r.stops.findIndex((s) => s.id === stopId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= r.stops.length || r.stops[i].doneAt || r.stops[j].doneAt) throw new ValidationError("This stop can't move there.");
  const order = r.stops.map((s) => ({ key: s.id, deliveryId: s.deliveryId, kind: s.kind, at: null }));
  [order[i], order[j]] = [order[j], order[i]];
  if (!isValidOrder(order)) throw new ValidationError("A pickup must come before its delivery.");
  await prisma.$transaction(async (tx) => {
    await tx.routeStop.update({ where: { id: r.stops[i].id }, data: { sequence: j + 1 } });
    await tx.routeStop.update({ where: { id: r.stops[j].id }, data: { sequence: i + 1 } });
    await refreshRoute(tx, routeId);
  });
}

/** Take a delivery off a route (not yet picked up): it goes back to "waiting for a route". */
export async function removeFromRoute(ctx: Ctx, routeId: string, deliveryId: string) {
  const r = await loadRoute(ctx, routeId);
  const d = r.stops.find((s) => s.deliveryId === deliveryId)?.delivery;
  if (!d || !OPEN_ROUTE.includes(r.status)) throw new NotFoundError("Delivery on this route");
  if (d.pickedUpAt || d.status !== "ASSIGNED") throw new ValidationError("Already picked up — it stays on this route.");
  await prisma.$transaction(async (tx) => {
    await tx.routeStop.deleteMany({ where: { routeId, deliveryId } });
    await tx.delivery.update({ where: { id: deliveryId }, data: { routeId: null, driverId: null, vehicleId: null, status: "UNASSIGNED", assignedAt: null, eta: null } });
    const left = await tx.routeStop.count({ where: { routeId } });
    if (!left) await tx.route.update({ where: { id: routeId }, data: { status: "CANCELLED" } });
    else await refreshRoute(tx, routeId);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "route.delivery_removed", entityType: "Route", entityId: routeId, after: { deliveryId } }, tx);
  });
}

export async function cancelRoute(ctx: Ctx, id: string) {
  const r = await loadRoute(ctx, id);
  if (r.status !== "PLANNED") throw new ValidationError("Only routes that haven't started can be cancelled.");
  await prisma.$transaction(async (tx) => {
    await tx.route.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.delivery.updateMany({ where: { routeId: id, status: "ASSIGNED", pickedUpAt: null }, data: { routeId: null, driverId: null, vehicleId: null, status: "UNASSIGNED", assignedAt: null, eta: null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "route.cancelled", entityType: "Route", entityId: id }, tx);
  });
}

/** Driver (or dispatcher) starts the route: ETAs from now; customers get their delivery window. */
export async function startRoute(ctx: Ctx, id: string) {
  const r = await prisma.route.findUnique({ where: { id }, include: { driver: { select: { userId: true } } } });
  if (!r) throw new NotFoundError("Route");
  const isDriver = r.driver?.userId === ctx.user.id && can(ctx, "driver.deliveries.update");
  if (!isDriver) { assertDispatcher(ctx); if (r.executingCompanyId !== ctx.company.id) throw new NotFoundError("Route"); }
  if (r.status !== "PLANNED") throw new ValidationError("This route has already started.");
  await prisma.$transaction(async (tx) => {
    await tx.route.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await refreshRoute(tx, id);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "route.started", entityType: "Route", entityId: id }, tx);
  });
  await notifyEtas(id);
}

/** Tell each customer on the route its delivery window. */
async function notifyEtas(routeId: string) {
  const settings = await routingSettings();
  const stops = await prisma.routeStop.findMany({ where: { routeId, kind: "DROP", doneAt: null }, include: { delivery: { select: { order: { select: { id: true, number: true, buyerCompanyId: true } } } } } });
  const hm = (d: Date) => new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(d);
  for (const s of stops) {
    if (!s.eta) continue;
    const half = (settings.etaWindowMinutes / 2) * 60_000;
    const o = s.delivery.order;
    await notify("delivery.eta", [{ companyId: o.buyerCompanyId, link: `/buy/orders/${o.id}` }], { number: o.number, from: hm(new Date(s.eta.getTime() - half)), to: hm(new Date(s.eta.getTime() + half)) }, { ref: { type: "Order", id: o.id } });
  }
}

/** Called after a driver records a delivery step: tick the stop, move the ETAs, close the route. */
export async function onDeliveryStep(deliveryId: string, step: "PICKED_UP" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "RETURNED") {
  const d = await prisma.delivery.findUnique({ where: { id: deliveryId }, select: { routeId: true } });
  if (!d?.routeId) return;
  const routeId = d.routeId;
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    if (step === "PICKED_UP") await tx.routeStop.updateMany({ where: { routeId, deliveryId, kind: "PICKUP", doneAt: null }, data: { doneAt: now } });
    if (step === "DELIVERED" || step === "FAILED" || step === "RETURNED") {
      await tx.routeStop.updateMany({ where: { routeId, deliveryId, kind: "PICKUP", doneAt: null }, data: { doneAt: now } });
      await tx.routeStop.updateMany({ where: { routeId, deliveryId, kind: "DROP", doneAt: null }, data: { doneAt: now } });
    }
    const r = await tx.route.findUniqueOrThrow({ where: { id: routeId } });
    if (r.status === "PLANNED") await tx.route.update({ where: { id: routeId }, data: { status: "IN_PROGRESS", startedAt: now } });
    const open = await tx.routeStop.count({ where: { routeId, doneAt: null } });
    if (!open) await tx.route.update({ where: { id: routeId }, data: { status: "COMPLETED", completedAt: now } });
    else await refreshRoute(tx, routeId);
  });
}

// ── reading ─────────────────────────────────────────────────────────────────

const routeListInclude = {
  driver: { select: { id: true, user: { select: { name: true } } } },
  vehicle: { select: { plate: true } },
  executor: { select: { legalName: true, tradeName: true, type: true } },
  stops: { select: { kind: true, doneAt: true, eta: true, plannedArrival: true } },
} satisfies Prisma.RouteInclude;

export async function listRoutes(ctx: Ctx, f: { date?: Date; status?: RouteStatus; all?: boolean } = {}) {
  assertViewer(ctx);
  const where: Prisma.RouteWhereInput = {
    ...(ctx.company.type === "ADMIN" && f.all ? {} : { executingCompanyId: ctx.company.id }),
    ...(f.date ? { date: new Date(Date.UTC(f.date.getUTCFullYear(), f.date.getUTCMonth(), f.date.getUTCDate())) } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
  const rows = await prisma.route.findMany({ where, include: routeListInclude, orderBy: [{ date: "desc" }, { number: "desc" }], take: 200 });
  return rows.map((r) => ({
    id: r.id, number: r.number, date: r.date, status: r.status, driver: r.driver?.user.name ?? "—", vehicle: r.vehicle?.plate ?? null,
    executor: r.executor.tradeName ?? r.executor.legalName, firingi: r.executor.type === "ADMIN",
    drops: r.stops.filter((s) => s.kind === "DROP").length, pickups: r.stops.filter((s) => s.kind === "PICKUP").length,
    done: r.stops.filter((s) => s.doneAt).length, total: r.stops.length,
    late: r.stops.filter((s) => !s.doneAt && s.eta && s.plannedArrival && s.eta.getTime() - s.plannedArrival.getTime() > 30 * 60_000).length,
    plannedKm: Number(r.plannedKm), plannedMinutes: r.plannedMinutes, plannedStartAt: r.plannedStartAt, startedAt: r.startedAt, completedAt: r.completedAt,
  }));
}

export async function routeDetail(ctx: Ctx, id: string) {
  const r = await loadRoute(ctx, id, false);
  const full = await prisma.route.findUniqueOrThrow({
    where: { id },
    include: {
      ...routeListInclude,
      stops: { orderBy: { sequence: "asc" }, include: { delivery: { select: { id: true, status: true, order: { select: { id: true, number: true, status: true } } } } } },
    },
  });
  return { route: full, canManage: r.executingCompanyId === ctx.company.id && (ctx.company.type === "ADMIN" ? can(ctx, [...ADMIN_PERMS]) : can(ctx, [...VENDOR_PERMS])) };
}

/** The driver's open routes (today first). */
export async function myRoutes(ctx: Ctx) {
  if (!ctx.driver || !can(ctx, "driver.deliveries.view")) throw new ForbiddenError();
  return prisma.route.findMany({
    where: { driverId: ctx.driver.id, status: { in: OPEN_ROUTE } },
    include: { vehicle: { select: { plate: true } }, stops: { orderBy: { sequence: "asc" }, include: { delivery: { select: { id: true, status: true, order: { select: { number: true } } } } } } },
    orderBy: [{ date: "asc" }, { plannedStartAt: "asc" }],
  });
}

export async function routeDrivers(ctx: Ctx) {
  assertDispatcher(ctx);
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { ownerCompanyId: ctx.company.id, status: "APPROVED" }, select: { id: true, availability: true, user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.vehicle.findMany({ where: { ownerCompanyId: ctx.company.id, status: "ACTIVE" }, select: { id: true, plate: true, type: true } }),
  ]);
  return { drivers: drivers.map((d) => ({ id: d.id, name: d.user.name, availability: d.availability })), vehicles };
}

export { n as toNumber };

/** FIRINGI's addresses that can be the routes' depot. */
export async function depotOptions(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const rows = await prisma.address.findMany({
    where: { isActive: true, kind: { in: ["WAREHOUSE", "PICKUP", "HEAD_OFFICE"] }, company: { OR: [{ type: "ADMIN" }, { isInHouse: true }] } },
    select: { id: true, label: true, cityName: true, company: { select: { tradeName: true, legalName: true } } },
  });
  return rows.map((a) => ({ id: a.id, label: `${a.company.tradeName ?? a.company.legalName} · ${a.label} · ${a.cityName}` }));
}

/** Open drop stops with their ETA against the plan (ETA management). */
export async function openEtas(ctx: Ctx, all = false) {
  assertViewer(ctx);
  const rows = await prisma.routeStop.findMany({
    where: { kind: "DROP", doneAt: null, route: { status: { in: OPEN_ROUTE }, ...(ctx.company.type === "ADMIN" && all ? {} : { executingCompanyId: ctx.company.id }) } },
    include: { route: { select: { id: true, number: true, status: true, driver: { select: { user: { select: { name: true } } } } } }, delivery: { select: { status: true, order: { select: { id: true, number: true } } } } },
    orderBy: { eta: "asc" }, take: 300,
  });
  return rows.map((s) => ({
    id: s.id, route: s.route, order: s.delivery.order, status: s.delivery.status, customer: s.label, address: s.address,
    planned: s.plannedArrival, eta: s.eta, delayMin: s.eta && s.plannedArrival ? Math.round((s.eta.getTime() - s.plannedArrival.getTime()) / 60_000) : null,
  }));
}
