/**
 * Phase 8: reporting engine — totals agree with the order book, breakdowns add up,
 * and every audience sees only its own slice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { analyticsScope, buyerMix, deliveryStats, grainFor, kpis, periodFrom, previousPeriod, report, statusFunnel, type Filters } from "@/server/analytics/engine";
import { ctxFor } from "../helpers";

afterAll(() => prisma.$disconnect());

/** Three Kebab House orders from Lisboa Central: one delivered, one cancelled, one open. */
beforeAll(async () => {
  const kebab = await ctxFor("owner@kebabhouse.test");
  const lx = await ctxFor("owner@lisboacentral.test");
  const ops = await ctxFor("ops@firingi.test");
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const place = async (sku: string, qty: number) => {
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, packaging: { variant: { sku } } } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
    await setStock(lx, offer.id, wh.id, Math.max(500, cur?.reserved ?? 0));
    await clearCart(kebab);
    await addToCart(kebab, offer.id, qty);
    return (await placeOrder(kebab, { deliveryAddressId: addr.id })).id;
  };
  const delivered = await place("FIR-MOZZ2", 30);
  await confirmOrder(lx, delivered, {});
  await changeOrderStatus(lx, delivered, "READY_FOR_PICKUP");
  await changeOrderStatus(ops, delivered, "DISPATCHED");
  await changeOrderStatus(ops, delivered, "OUT_FOR_DELIVERY");
  await changeOrderStatus(ops, delivered, "DELIVERED");
  const cancelled = await place("FIR-AZEITE75", 12);
  await changeOrderStatus(kebab, cancelled, "CANCELLED", "test");
  await place("FIR-AZEITE75", 14);
});

const YEAR: Filters = { from: new Date("2020-01-01T00:00:00Z"), to: new Date("2031-01-01T00:00:00Z"), basis: "placed" };
const n = (d: unknown) => Number(d ?? 0);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.011);

describe("engine totals", () => {
  it("placed basis matches the order book (excluding cancelled)", async () => {
    const agg = await prisma.order.aggregate({ where: { status: { not: "CANCELLED" } }, _count: true, _sum: { netTotal: true, grandTotal: true, firingiMarginNet: true, deliveryFeeNet: true, commissionTotal: true } });
    const k = await kpis(YEAR);
    expect(k.orders).toBe(agg._count);
    close(k.net, n(agg._sum.netTotal));
    close(k.gross, n(agg._sum.grandTotal));
    close(k.commission, n(agg._sum.commissionTotal));
    close(k.revenue, n(agg._sum.firingiMarginNet) + n(agg._sum.deliveryFeeNet));
    expect(k.cancelled).toBe(await prisma.order.count({ where: { status: "CANCELLED" } }));
  });

  it("delivered basis counts delivered and returned orders only", async () => {
    const [r] = await report({ ...YEAR, basis: "delivered" }, [], ["orders"]);
    expect(r.values.orders).toBe(await prisma.order.count({ where: { status: { in: ["DELIVERED", "RETURNED"] } } }));
  });

  it("breakdowns add up to the total", async () => {
    const [total] = await report(YEAR, [], ["orders", "net", "margin"]);
    for (const dim of ["vendor", "buyer", "country", "flow", "month", "region"] as const) {
      const rows = await report(YEAR, [dim], ["orders", "net", "margin"]);
      expect(rows.reduce((a, r) => a + r.values.orders, 0)).toBe(total.values.orders);
      close(rows.reduce((a, r) => a + r.values.net, 0), total.values.net);
    }
  });

  it("product lines add up to goods net and units", async () => {
    const lines = await prisma.orderLine.aggregate({ where: { order: { status: { not: "CANCELLED" } } }, _sum: { lineNet: true } });
    const rows = await report(YEAR, ["product"], ["net", "units", "margin"]);
    close(rows.reduce((a, r) => a + r.values.net, 0), n(lines._sum.lineNet));
    expect(rows.every((r) => r.values.units > 0)).toBe(true);
    // sorted by the first metric, highest first
    expect(rows.map((r) => r.values.net)).toEqual([...rows.map((r) => r.values.net)].sort((a, b) => b - a));
    const roots = await report(YEAR, ["categoryRoot"], ["net"]);
    close(roots.reduce((a, r) => a + r.values.net, 0), n(lines._sum.lineNet));
    // a category filter keeps only that subtree
    const top = roots[0].keys.categoryRoot!;
    const [sub] = await report({ ...YEAR, categoryId: top }, [], ["net"]);
    close(sub.values.net, roots[0].values.net);
  });

  it("time series are ordered by date", async () => {
    const rows = await report(YEAR, ["day"], ["orders"]);
    const keys = rows.map((r) => r.keys.day!);
    expect(keys).toEqual([...keys].sort());
  });

  it("refuses unknown or impossible combinations", async () => {
    await expect(report(YEAR, ["nope" as never], ["orders"])).rejects.toThrow();
    await expect(report(YEAR, ["product"], ["fees"])).rejects.toThrow(/can't be split/);
    await expect(report(YEAR, ["vendor"], ["units", "vat"])).rejects.toThrow(/can't be split/);
    await expect(report(YEAR, ["vendor"], [])).rejects.toThrow();
  });

  it("funnel, buyer mix and delivery stats", async () => {
    const funnel = await statusFunnel(YEAR);
    expect(funnel.reduce((a, r) => a + r.n, 0)).toBe(await prisma.order.count());
    const mix = await buyerMix(YEAR);
    expect(mix.fresh + mix.returning).toBe(mix.active);
    expect(mix.fresh).toBe(mix.active); // nothing placed before 2020
    const d = await deliveryStats(YEAR);
    expect(d.delivered).toBeGreaterThanOrEqual(0);
    expect(d.byMode.reduce((a, r) => a + r.delivered + r.failed, 0)).toBe(d.delivered + d.failed + d.returned);
  });
});

describe("periods", () => {
  const now = new Date("2026-11-09T15:00:00Z");
  it("presets", () => {
    expect(periodFrom("7d", undefined, undefined, now)).toMatchObject({ from: new Date("2026-11-03T00:00:00Z"), to: new Date("2026-11-10T00:00:00Z") });
    expect(periodFrom("mtd", undefined, undefined, now).from).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(periodFrom("lastmonth", undefined, undefined, now)).toMatchObject({ from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") });
    expect(periodFrom("custom", "2026-01-01", "2026-01-31", now)).toMatchObject({ from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-02-01T00:00:00Z") });
    expect(periodFrom("custom", "2026-02-01", "2026-01-01", now).preset).toBe("30d");
    expect(periodFrom(undefined, undefined, undefined, now).preset).toBe("30d");
    expect(() => periodFrom("custom", "2020-01-01", "2026-01-01", now)).toThrow();
  });
  it("previous period and grain", () => {
    const f = { ...YEAR, from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };
    expect(previousPeriod(f)).toMatchObject({ from: new Date("2026-08-31T00:00:00Z"), to: f.from });
    expect(grainFor(f.from, f.to)).toBe("day");
    expect(grainFor(new Date("2026-01-01"), new Date("2026-06-01"))).toBe("week");
    expect(grainFor(new Date("2025-01-01"), new Date("2026-06-01"))).toBe("month");
  });
});

describe("who sees what", () => {
  it("vendors see only their own sales, buyers only their purchases", async () => {
    const vendor = await ctxFor("owner@lisboacentral.test");
    const vs = await analyticsScope(vendor, "VENDOR");
    expect(vs).toEqual({ vendorId: vendor.company.id });
    const [mine] = await report({ ...YEAR, ...vs }, [], ["orders"]);
    expect(mine.values.orders).toBe(await prisma.order.count({ where: { sellerCompanyId: vendor.company.id, status: { not: "CANCELLED" } } }));
    const byVendor = await report({ ...YEAR, ...vs }, ["vendor"], ["orders"]);
    expect(byVendor.map((r) => r.keys.vendor)).toEqual([vendor.company.id]);

    const buyer = await ctxFor("owner@kebabhouse.test");
    const bs = await analyticsScope(buyer, "BUYER");
    expect(bs).toEqual({ buyerId: buyer.company.id });
    const byBuyer = await report({ ...YEAR, ...bs }, ["buyer"], ["orders"]);
    expect(byBuyer.map((r) => r.keys.buyer)).toEqual([buyer.company.id]);
    // a wholesaler is both: its purchasing team gets the buyer report
    expect(await analyticsScope(await ctxFor("purchasing@lisboacentral.test"), "BUYER")).toEqual({ buyerId: vendor.company.id });
  });

  it("roles without the permission are refused", async () => {
    await expect(analyticsScope(await ctxFor("warehouse@lisboacentral.test"), "VENDOR")).rejects.toThrow();
    await expect(analyticsScope(await ctxFor("owner@kebabhouse.test"), "VENDOR")).rejects.toThrow();
    await expect(analyticsScope(await ctxFor("owner@kebabhouse.test"), "ADMIN")).rejects.toThrow();
    await expect(analyticsScope(await ctxFor("owner@lisboacentral.test"), "ADMIN")).rejects.toThrow();
    await expect(analyticsScope(await ctxFor("driver@firingi.test"), "ADMIN")).rejects.toThrow();
  });

  it("FIRINGI sees everything; a regional manager only their regions' buyers", async () => {
    expect(await analyticsScope(await ctxFor("superadmin@firingi.test"), "ADMIN")).toEqual({});
    const rm = await ctxFor("rm.lisboa@firingi.test");
    const scope = await analyticsScope(rm, "ADMIN");
    expect(Array.isArray(scope.buyerIds)).toBe(true);
    const [all] = await report(YEAR, [], ["orders"]);
    const [regional] = await report({ ...YEAR, ...scope }, [], ["orders"]);
    expect(regional.values.orders).toBeLessThanOrEqual(all.values.orders);
    const rows = await report({ ...YEAR, ...scope }, ["buyer"], ["orders"]);
    expect(rows.every((r) => scope.buyerIds!.includes(r.keys.buyer!))).toBe(true);
    const [none] = await report({ ...YEAR, buyerIds: [] }, [], ["orders"]);
    expect(none.values.orders).toBe(0);
  });
});
