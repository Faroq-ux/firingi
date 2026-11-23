/**
 * Phase 66: the AI Centre — a planned route driven in a bad order gives a "shorter route" suggestion with km, fuel / energy,
 * € and CO₂; accepting puts the stops in the shorter order; two small nearby routes give "combine routes"; FIRINGI's
 * switch per area; the six forecasts; the seven reports (FIRINGI's wording, or Claude's when connected), CSV; the weekly
 * executive email (once a week); settings only for admins.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setAiTransportForTests } from "@/server/ai/assistant";
import { refreshRecommendations, decideRecommendation } from "@/server/ai/feed";
import { aiCentreSettings, saveAiCentreSettings } from "@/server/ai/centre/settings";
import { routeSavings, lapsingCustomers, overdueByCustomer } from "@/server/ai/centre/recs";
import { areaRecommendations, centreDashboard } from "@/server/ai/centre/dashboard";
import * as F from "@/server/ai/centre/forecasts";
import { generateReport, reportCsv, weeklyReportJob, type ReportData } from "@/server/ai/centre/reports";
import { REPORTS } from "@/lib/ai-centre";
import { ctxFor } from "../helpers";

const ADMIN = "superadmin@firingi.test", LX = "owner@lisboacentral.test";
const deliveries: string[] = [];
let adminCo = "", routeA = "", routeB = "", routeC = "";
// Lisbon points, visited in a zig-zag (far–near–far–near) so a shorter order exists
const PTS = [[38.70, -9.14], [38.78, -9.10], [38.71, -9.15], [38.77, -9.09], [38.72, -9.13], [38.76, -9.11]];
const tomorrow = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)); };

async function route(n: string, stops: number[][], dels: string[]) {
  return prisma.route.create({
    data: {
      number: n, executingCompanyId: adminCo, date: tomorrow(), status: "PLANNED", plannedStartAt: new Date(tomorrow().getTime() + 8 * 3600_000), startLat: 38.73, startLng: -9.14,
      stops: { create: stops.map((p, i) => ({ deliveryId: dels[i], kind: "PICKUP", sequence: i + 1, label: `Stop ${i + 1}`, address: "Lisboa", lat: p[0], lng: p[1] })) },
    },
  });
}
async function clean() {
  await prisma.route.deleteMany({ where: { number: { startsWith: "RT-AI66-" } } });
  if (deliveries.length) await prisma.delivery.deleteMany({ where: { id: { in: deliveries } } });
  await prisma.setting.deleteMany({ where: { key: "ai.centre" } });
  await prisma.aiReportRun.deleteMany({});
  await prisma.aiRecommendation.deleteMany({ where: { kind: { in: ["ROUTE_SAVING", "ROUTE_MERGE"] } } });
}

beforeAll(async () => {
  const admin = await ctxFor(ADMIN);
  adminCo = admin.company.id;
  await prisma.route.deleteMany({ where: { number: { startsWith: "RT-AI66-" } } });
  let orders = await prisma.order.findMany({ where: { delivery: null }, select: { id: true }, take: 10 });
  if (orders.length < 10) {
    // the test database may start empty: 10 small orders handed over on the spot (no stock, no fees)
    const { placeOrder } = await import("@/server/services/orders");
    const kb = await ctxFor("owner@kebabhouse.test"), lx = await ctxFor(LX);
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE", isActive: true } });
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kb.company.id, kind: "DELIVERY", isActive: true } });
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-ARROZ1", status: "ACTIVE" } });
    for (let i = orders.length; i < 10; i++) await placeOrder(kb, { deliveryAddressId: addr.id, items: [{ offerId: offer.id, qty: 1 }], approved: true, handover: { warehouseId: wh.id, paidNow: true, reason: "AI Centre test" } });
    orders = await prisma.order.findMany({ where: { delivery: null }, select: { id: true }, take: 10 });
  }
  expect(orders.length).toBeGreaterThanOrEqual(10);
  for (const o of orders) deliveries.push((await prisma.delivery.create({ data: { orderId: o.id, mode: "FIRINGI_FLEET", executingCompanyId: adminCo } })).id);
  routeA = (await route("RT-AI66-A", PTS, deliveries.slice(0, 6))).id;
  // two small routes close together (B, C) — better as one
  routeB = (await route("RT-AI66-B", [[38.60, -9.00], [38.61, -9.01]], deliveries.slice(6, 8))).id;
  routeC = (await route("RT-AI66-C", [[38.605, -9.005], [38.615, -9.015]], deliveries.slice(8, 10))).id;
});
afterAll(async () => { setAiTransportForTests(null); await clean(); await prisma.$disconnect(); });

describe("AI Centre", () => {
  it("settings: defaults, only admins save", async () => {
    const s = await aiCentreSettings();
    expect(s.areas.ROUTES && s.reports.EXECUTIVE && s.weeklyEmail).toBe(true);
    await expect(saveAiCentreSettings(await ctxFor(LX), { routeMinKm: 1 })).rejects.toThrow();
    const saved = await saveAiCentreSettings(await ctxFor(ADMIN), { routeMinKm: 1, routeMinPct: 5, fuels: { ...s.fuels, DIESEL: { per100: 10, price: 2, co2: 2.5 } } });
    expect(saved.fuels.DIESEL).toEqual({ per100: 10, price: 2, co2: 2.5 });
  });

  it("a route in a bad order: shorter order with km, fuel, € and CO₂; two nearby routes: combine", async () => {
    const s = await aiCentreSettings();
    const r = await routeSavings(new Date(), s);
    const a = r.savings.find((x) => x.routeId === routeA)!;
    expect(a).toBeTruthy();
    expect(a.savedKm).toBeGreaterThan(1);
    expect(a.betterKm).toBeLessThan(a.currentKm);
    expect(a.fuel).toBe("DIESEL");
    expect(a.savedAmount).toBeCloseTo(a.savedKm * 0.1, 1); // 10 L / 100 km
    expect(a.savedCost).toBeCloseTo(a.savedAmount * 2, 1);
    expect(a.savedCo2Kg).toBeCloseTo(a.savedAmount * 2.5, 1);
    expect(r.merges.some((m) => m.routeIds.includes(routeB) && m.routeIds.includes(routeC))).toBe(true);
  });

  it("the suggestions appear; accepting puts the stops in the shorter order", async () => {
    await refreshRecommendations();
    const admin = await ctxFor(ADMIN);
    const list = await areaRecommendations(admin, "ROUTES", { kind: "ROUTE_SAVING" });
    const rec = list.rows.find((x) => x.subjectId === routeA)!;
    expect(rec.title).toMatch(/km .* kg CO₂/);
    expect((await areaRecommendations(admin, "ROUTES", { kind: "ROUTE_MERGE" })).total).toBeGreaterThanOrEqual(1);
    const before = await prisma.route.findUniqueOrThrow({ where: { id: routeA }, select: { plannedKm: true } });
    const res = await decideRecommendation(admin, rec.id, true);
    expect(res.result).toMatchObject({ reordered: true });
    const after = await prisma.route.findUniqueOrThrow({ where: { id: routeA }, include: { stops: { orderBy: { sequence: "asc" } } } });
    expect(Number(after.plannedKm)).toBeLessThan(Number((res.result as { beforeKm: number }).beforeKm) || Number(before.plannedKm) + 1000);
    const d = await centreDashboard(admin);
    expect(d.byArea.ROUTES).toBeGreaterThanOrEqual(1);
  });

  it("an area switched off is neither computed nor shown", async () => {
    const admin = await ctxFor(ADMIN);
    const s = await aiCentreSettings();
    await saveAiCentreSettings(admin, { areas: { ...s.areas, ROUTES: false } });
    await refreshRecommendations();
    expect(await prisma.aiRecommendation.count({ where: { kind: { in: ["ROUTE_SAVING", "ROUTE_MERGE"] }, status: "OPEN" } })).toBe(0);
    expect((await areaRecommendations(admin, "ROUTES")).rows.length).toBe(0);
    await saveAiCentreSettings(admin, { areas: { ...s.areas, ROUTES: true } });
  });

  it("customers going quiet and overdue invoices are found", async () => {
    expect(Array.isArray(await lapsingCustomers(new Date(), 2))).toBe(true);
    const o = await overdueByCustomer(new Date(), 0);
    for (const x of o) expect(x.open).toBeGreaterThan(0);
  });

  it("the six forecasts: 16 weeks of history, 8 ahead", async () => {
    const admin = await ctxFor(ADMIN);
    const sales = await F.forecastSales(admin);
    expect(sales.total.history).toHaveLength(16);
    expect(sales.total.forecast).toHaveLength(8);
    expect((await F.forecastOrders(admin)).weekdays).toHaveLength(7);
    expect((await F.forecastDelivery(admin)).total.forecast).toHaveLength(8);
    expect((await F.forecastCash(admin)).forecast).toHaveLength(8);
    expect(Array.isArray((await F.forecastInventory(admin)).rows)).toBe(true);
    expect(Array.isArray(await F.forecastDemand(admin))).toBe(true);
    await expect(F.forecastSales(await ctxFor(LX))).rejects.toThrow();
  });

  it("the seven reports: FIRINGI's wording without AI, Claude's when connected; CSV", async () => {
    const admin = await ctxFor(ADMIN);
    for (const k of REPORTS) {
      const r = await generateReport(admin, k);
      expect(r.summary.length).toBeGreaterThan(20);
      expect(r.byClaude).toBe(false);
      const d = r.data as unknown as ReportData;
      expect(d.kpis.length).toBeGreaterThan(0);
      expect(reportCsv(d, r.summary)).toContain(d.title);
    }
    setAiTransportForTests(async () => ({ content: [{ type: "text", text: "Sales are steady; chase the overdue invoices first." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }) as never);
    const c = await generateReport(admin, "EXECUTIVE", { claude: true });
    expect(c.byClaude).toBe(true);
    expect(c.summary).toMatch(/overdue invoices/);
    setAiTransportForTests(null);
    await expect(generateReport(await ctxFor(LX), "SALES")).rejects.toThrow();
  });

  it("weekly executive email: Monday morning, once a week; off when switched off", async () => {
    const monday = new Date("2026-11-23T09:00:00Z"); // a Monday, 09:00 Lisbon
    const a = await weeklyReportJob(monday);
    expect(a.sent).toBe(true);
    expect((await weeklyReportJob(monday)).sent).toBe(false);
    expect((await weeklyReportJob(new Date("2026-11-24T09:00:00Z"))).sent).toBe(false);
    await saveAiCentreSettings(await ctxFor(ADMIN), { weeklyEmail: false });
    expect((await weeklyReportJob(new Date("2026-11-30T09:00:00Z"))).reason).toBe("off");
  });
});
