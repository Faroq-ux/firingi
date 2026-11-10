/**
 * Phase 12: multi-stop routes for FIRINGI's fleet.
 *   plan (pickups before drops, ETAs) → the multi-order limit applies → stops can be moved
 *   (never a drop before its pickup) → start (customers get their ETA window) → each driver
 *   step ticks its stop → the route completes; cancelled / reassigned orders leave the route.
 *   Plus auto-planning, performance and FIRINGI drivers' earnings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import { DEFAULT_POLICY, setMultiOrderPolicy } from "@/server/services/delivery-settings";
import { autoPlan, cancelRoute, createRoute, listRoutes, moveStop, myRoutes, plannableDeliveries, removeFromRoute, reoptimiseRoute, routeDetail, setRoutingSettings, startRoute } from "@/server/services/routes";
import { deliveryPerformance, driverEarnings, driverPerformance, liveBoard, periodFrom } from "@/server/services/route-stats";
import { isValidOrder } from "@/server/delivery/routing";
import { ctxFor, pngFile } from "../helpers";

const KEBAB = "owner@kebabhouse.test";
const LX_OWNER = "owner@lisboacentral.test";
const OPS = "ops@firingi.test";
const SA = "superadmin@firingi.test";
const FIR_DRIVER = "driver@firingi.test";
let driverId = "";
const today = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

/** A small order (5 boxes, below Lisboa Central's free-delivery minimum) → FIRINGI's fleet delivers. */
async function smallOrder() {
  const kebab = await ctxFor(KEBAB);
  const lx = await ctxFor(LX_OWNER);
  await clearCart(kebab);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await addToCart(kebab, offer.id, 5);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
  await confirmOrder(lx, id, {});
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } });
  expect(d.mode).toBe("FIRINGI_FLEET");
  return { orderId: id, deliveryId: d.id };
}
/** Free the driver: close their open routes and deliveries from earlier runs. */
async function freeDriver() {
  await prisma.route.updateMany({ where: { driverId, status: { in: ["PLANNED", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
  await prisma.delivery.updateMany({ where: { driverId, status: { in: ["ASSIGNED"] } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.delivery.updateMany({ where: { driverId, status: { in: ["PICKED_UP", "OUT_FOR_DELIVERY"] } }, data: { status: "DELIVERED", completedAt: new Date(), routeId: null } });
  await prisma.driver.update({ where: { id: driverId }, data: { availability: "AVAILABLE" } });
}

beforeAll(async () => {
  driverId = (await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } })).id;
  await setMultiOrderPolicy(await ctxFor(SA), { ...DEFAULT_POLICY, firingiFleet: true, firingiMax: 6 });
  await freeDriver();
});
afterAll(async () => {
  await setMultiOrderPolicy(await ctxFor(SA), DEFAULT_POLICY);
  await prisma.$disconnect();
});

describe("routes", () => {
  it("plans a multi-stop route: pickups before drops, ETAs, deliveries assigned, driver told", async () => {
    const ops = await ctxFor(OPS);
    const a = await smallOrder(), b = await smallOrder(), c = await smallOrder();
    const plannable = await plannableDeliveries(ops);
    expect(plannable.map((p) => p.id)).toEqual(expect.arrayContaining([a.deliveryId, b.deliveryId, c.deliveryId]));
    const before = await prisma.notification.count({ where: { user: { email: FIR_DRIVER }, type: "route.assigned" } });
    const r = await createRoute(ops, { date: today(), driverId, deliveryIds: [a.deliveryId, b.deliveryId, c.deliveryId] });
    expect(r.number).toMatch(/^RT-\d{4}-\d+/);
    const { route } = await routeDetail(ops, r.id);
    expect(route.stops).toHaveLength(6);
    expect(isValidOrder(route.stops.map((s) => ({ key: s.id, deliveryId: s.deliveryId, kind: s.kind, at: null })))).toBe(true);
    expect(route.stops.every((s) => s.eta && s.plannedArrival)).toBe(true);
    for (let i = 1; i < route.stops.length; i++) expect(route.stops[i].eta!.getTime()).toBeGreaterThanOrEqual(route.stops[i - 1].eta!.getTime());
    const ds = await prisma.delivery.findMany({ where: { id: { in: [a.deliveryId, b.deliveryId, c.deliveryId] } } });
    expect(ds.every((d) => d.status === "ASSIGNED" && d.driverId === driverId && d.routeId === r.id && d.eta)).toBe(true);
    expect(await prisma.notification.count({ where: { user: { email: FIR_DRIVER }, type: "route.assigned" } })).toBe(before + 1);
    // Already on a route → not plannable twice.
    await expect(createRoute(ops, { date: today(), driverId, deliveryIds: [a.deliveryId] })).rejects.toThrow(/can't be planned/);
    // The driver sees it; a vendor can't touch FIRINGI's route.
    expect((await myRoutes(await ctxFor(FIR_DRIVER))).map((x) => x.id)).toContain(r.id);
    await expect(cancelRoute(await ctxFor(LX_OWNER), r.id)).rejects.toThrow();

    // Stop order: a drop can't move before its own pickup.
    const firstDrop = route.stops.findIndex((s) => s.kind === "DROP");
    const own = route.stops.findIndex((s) => s.kind === "PICKUP" && s.deliveryId === route.stops[firstDrop].deliveryId);
    if (own === firstDrop - 1) await expect(moveStop(ops, r.id, route.stops[firstDrop].id, -1)).rejects.toThrow(/pickup must come before/);
    // Re-optimising never makes the route longer.
    const opt = await reoptimiseRoute(ops, r.id);
    expect(opt.afterKm).toBeLessThanOrEqual(opt.beforeKm + 0.01);

    // Remove one (not picked up) → back to waiting.
    await removeFromRoute(ops, r.id, c.deliveryId);
    const dc = await prisma.delivery.findUniqueOrThrow({ where: { id: c.deliveryId } });
    expect(dc).toMatchObject({ status: "UNASSIGNED", routeId: null, driverId: null });
    expect(await prisma.routeStop.count({ where: { routeId: r.id } })).toBe(4);

    // Cancel the planned route → its deliveries wait again.
    await cancelRoute(ops, r.id);
    expect((await prisma.route.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: a.deliveryId } })).status).toBe("UNASSIGNED");
  });

  it("respects the multi-order limit of FIRINGI's fleet", async () => {
    const ops = await ctxFor(OPS);
    const sa = await ctxFor(SA);
    const a = await smallOrder(), b = await smallOrder();
    await setMultiOrderPolicy(sa, { ...DEFAULT_POLICY, firingiFleet: false });
    await expect(createRoute(ops, { date: today(), driverId, deliveryIds: [a.deliveryId, b.deliveryId] })).rejects.toThrow(/one order per driver/);
    await setMultiOrderPolicy(sa, { ...DEFAULT_POLICY, firingiFleet: true, firingiMax: 6 });
    const r = await createRoute(ops, { date: today(), driverId, deliveryIds: [a.deliveryId, b.deliveryId] });
    await cancelRoute(ops, r.id);
  });

  it("runs a route: start → customers get an ETA window → stops tick → completed; earnings", async () => {
    const ops = await ctxFor(OPS);
    const lx = await ctxFor(LX_OWNER);
    const drv = await ctxFor(FIR_DRIVER);
    await setRoutingSettings(ops, { etaWindowMinutes: 60 });
    const a = await smallOrder(), b = await smallOrder(), c = await smallOrder();
    const r = await createRoute(ops, { date: today(), driverId, deliveryIds: [a.deliveryId, b.deliveryId, c.deliveryId] });
    const etaBefore = await prisma.notification.count({ where: { user: { email: KEBAB }, type: "delivery.eta" } });
    await startRoute(drv, r.id);
    expect((await prisma.route.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("IN_PROGRESS");
    expect(await prisma.notification.count({ where: { user: { email: KEBAB }, type: "delivery.eta" } })).toBe(etaBefore + 3);
    await expect(startRoute(drv, r.id)).rejects.toThrow(/already started/);

    // Order c is cancelled by FIRINGI while on the route → it leaves the route.
    await changeOrderStatus(ops, c.orderId, "CANCELLED", "Customer called to cancel");
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: c.deliveryId } })).routeId).toBeNull();
    expect(await prisma.routeStop.count({ where: { routeId: r.id, deliveryId: c.deliveryId } })).toBe(0);

    for (const x of [a, b]) {
      await changeOrderStatus(lx, x.orderId, "READY_FOR_PICKUP");
      await pickUp(drv, x.deliveryId);
      expect((await prisma.routeStop.findFirstOrThrow({ where: { routeId: r.id, deliveryId: x.deliveryId, kind: "PICKUP" } })).doneAt).not.toBeNull();
    }
    const board = await liveBoard(ops);
    const row = board.rows.find((x) => x.id === r.id)!;
    expect(row).toMatchObject({ status: "IN_PROGRESS", done: 2, total: 4 });
    expect(row.next?.kind).toBe("DROP");

    for (const x of [a, b]) {
      await startDelivery(drv, x.deliveryId);
      await completeDelivery(drv, x.deliveryId, { recipientName: "Ahmed", signature: pngFile() });
    }
    const done = await prisma.route.findUniqueOrThrow({ where: { id: r.id }, include: { stops: true } });
    expect(done.status).toBe("COMPLETED");
    expect(done.stops.every((s) => s.doneAt)).toBe(true);
    expect((await listRoutes(ops, { status: "COMPLETED" })).map((x) => x.id)).toContain(r.id);

    const p = periodFrom({});
    const perf = await deliveryPerformance(ops, p);
    expect(perf.delivered).toBeGreaterThanOrEqual(2);
    expect(perf.onTimeRate).not.toBeNull();
    const drivers = await driverPerformance(ops, p);
    expect(drivers.find((d) => d.id === driverId)!.delivered).toBeGreaterThanOrEqual(2);
    const pay = await driverEarnings(ops, p);
    const mine = pay.rows.find((x) => x.id === driverId)!;
    expect(mine.routes).toBeGreaterThanOrEqual(1);
    expect(mine.total).toBeCloseTo(mine.routes * pay.pay.perRoute + mine.delivered * pay.pay.perDelivery + mine.km * pay.pay.perKm, 2);
    await expect(driverEarnings(lx, p)).rejects.toThrow();
  });

  it("a delivery handed to another driver by hand leaves its route", async () => {
    const ops = await ctxFor(OPS);
    const a = await smallOrder(), b = await smallOrder();
    const r = await createRoute(ops, { date: today(), driverId, deliveryIds: [a.deliveryId, b.deliveryId] });
    await assignDelivery(ops, a.deliveryId, { driverId: null });
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: a.deliveryId } })).routeId).toBeNull();
    expect(await prisma.routeStop.count({ where: { routeId: r.id } })).toBe(2);
    await cancelRoute(ops, r.id);
  });

  it("auto-plans the day over free drivers", async () => {
    const ops = await ctxFor(OPS);
    await freeDriver();
    await smallOrder();
    const waiting = (await plannableDeliveries(ops)).length;
    const res = await autoPlan(ops, today());
    expect(res.routes.length).toBeGreaterThanOrEqual(1);
    expect(res.planned + res.left).toBe(waiting);
    const onRoutes = await prisma.delivery.count({ where: { routeId: { in: res.routes.map((x) => x.id) } } });
    expect(onRoutes).toBe(res.planned);
    // That driver now has a route today → no free driver left for a second run.
    await expect(autoPlan(ops, today())).rejects.toThrow(/No free driver|Nothing to plan/);
    for (const x of res.routes) await cancelRoute(ops, x.id);
  });
});
