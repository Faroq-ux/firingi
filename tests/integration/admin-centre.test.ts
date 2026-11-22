/**
 * Phase 59: the admin dashboard's extra information — every figure matches the records it summarises,
 * only waiting items are listed (each with its page), money and health only for people who may see them.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { adminCentre, comparePeriods, pctChange } from "@/server/data/admin-centre";
import { ctxFor } from "../helpers";

afterAll(async () => { await prisma.$disconnect(); });

describe("admin dashboard: more information", () => {
  it("compares this month so far with the same days of last month", () => {
    const p = comparePeriods(new Date(2026, 10, 22, 15, 0));
    expect(p.monthStart).toEqual(new Date(2026, 10, 1));
    expect(p.lastStart).toEqual(new Date(2026, 9, 1));
    expect(p.lastSame).toEqual(new Date(2026, 9, 22, 15, 0));
    // 31 March → last month has only 28 days: never past its end
    expect(comparePeriods(new Date(2027, 2, 31, 12)).lastSame).toEqual(new Date(2027, 2, 1));
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(0, 80)).toBe(-100);
  });

  it("sales, pipeline and top lists add up to the orders themselves", async () => {
    const ctx = await ctxFor("superadmin@firingi.test");
    const d = await adminCentre(ctx);
    const { monthStart } = comparePeriods();
    const orders = await prisma.order.count({ where: { status: { not: "CANCELLED" }, placedAt: { gte: monthStart } } });
    expect(d.sales.orders).toBe(orders);
    const pending = await prisma.order.count({ where: { status: "PENDING_CONFIRMATION" } });
    expect(d.pipeline.steps.find((s) => s.status === "PENDING_CONFIRMATION")?.count).toBe(pending);
    expect(d.byChannel.reduce((a, c) => a + c.orders, 0)).toBe(orders);
    if (d.byCountry.length) expect(Math.round(d.byCountry.reduce((a, c) => a + c.share, 0))).toBeGreaterThanOrEqual(99);
    expect(d.topSuppliers.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < d.topSuppliers.length; i++) expect(d.topSuppliers[i - 1].net).toBeGreaterThanOrEqual(d.topSuppliers[i].net);
    expect(d.sales.daily.reduce((a, x) => a + x.net, 0)).toBeCloseTo(d.sales.net, 0);
  });

  it("lists only what is waiting, each with the page that handles it", async () => {
    const d = await adminCentre(await ctxFor("superadmin@firingi.test"));
    expect(d.actions.every((a) => a.count > 0 && a.href.startsWith("/admin/"))).toBe(true);
    const held = await prisma.order.count({ where: { status: "ON_HOLD" } });
    expect(d.actions.some((a) => a.key === "onHold")).toBe(held > 0);
  });

  it("money and platform health for people who may see them; customers are refused", async () => {
    const d = await adminCentre(await ctxFor("superadmin@firingi.test"));
    expect(d.money).not.toBeNull();
    expect(d.money!.overdue).toBeLessThanOrEqual(d.money!.receivable);
    expect(d.health?.status).toMatch(/ok|warning|critical/);
    await expect(adminCentre(await ctxFor("owner@kebabhouse.test"))).rejects.toThrow();
  });
});
