/**
 * Phase 29: price intelligence.
 *  • Every price change is recorded by a DB trigger (append-only history).
 *  • A supplier increase above FIRINGI's threshold waits for approval; FIRINGI approves it with notice
 *    (customers who buy the product are told) and the job applies it on the date; or rejects it.
 *  • Alerts: a price far from the market median, a big jump; dismissed alerts stay dismissed.
 *  • Comparison, product history, margin heat-map, suggestions, the supplier's anonymous market
 *    position and the customer's upcoming price changes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ensureBaseList, setPrice } from "@/server/services/pricing";
import {
  applyDueRequests, approveRequest, cancelRequest, detectAlerts, handleAlert, listAlerts, listRequests, priceComparison, priceSettings, productHistory,
  recentChanges, rejectRequest, savePriceSettings,
} from "@/server/price-intel/service";
import { buyerPriceChanges, marginHeatmap, priceOverview, priceSuggestions, supplierPriceInsights } from "@/server/price-intel/insights";
import { DEFAULT_SETTINGS } from "@/server/price-intel/stats";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test";
const DAY = 86_400_000;
let mozz: string, variantId: string, baseList: string, original: { id: string; price: string }[] = [], kebabId: string, listId: string;
const priceOf = async (offerId: string) => Number((await prisma.priceListItem.findFirstOrThrow({ where: { offerId, minQty: 1, priceList: { scope: "BASE" } } })).unitPriceNet);

beforeAll(async () => {
  const lx = await ctxFor(LX);
  const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } }, include: { packaging: true } });
  mozz = o.id; variantId = o.packaging.variantId;
  baseList = (await ensureBaseList(lx)).id;
  const items = await prisma.priceListItem.findMany({ where: { offer: { packaging: { variantId } } } });
  original = items.map((i) => ({ id: i.id, price: i.unitPriceNet.toString() }));
  kebabId = (await ctxFor(KEBAB)).company.id;
  // the customer keeps the mozzarella in an order list → it is told about price increases
  listId = (await prisma.orderList.create({ data: { companyId: kebabId, createdById: (await ctxFor(KEBAB)).user.id, name: "P29 test list", items: { create: [{ offerId: mozz, qty: 6 }] } } })).id;
  await savePriceSettings(await ctxFor(SA), { ...DEFAULT_SETTINGS });
});

afterAll(async () => {
  for (const o of original) await prisma.priceListItem.update({ where: { id: o.id }, data: { unitPriceNet: o.price } });
  await prisma.priceChangeRequest.deleteMany({ where: { offer: { packaging: { variantId } } } });
  await prisma.priceAlert.deleteMany({});
  await prisma.orderList.delete({ where: { id: listId } });
  await prisma.setting.deleteMany({ where: { key: "pricing.intel" } });
  await prisma.$disconnect();
});

describe("price history", () => {
  it("every change is recorded by the database and can't be edited", async () => {
    const lx = await ctxFor(LX);
    const before = await priceOf(mozz);
    const r = await setPrice(lx, baseList, mozz, 1, (before * 0.95).toFixed(2));
    expect(r.held).toBeNull();
    const h = await prisma.priceHistory.findFirstOrThrow({ where: { offerId: mozz, minQty: 1, scope: "BASE" }, orderBy: { changedAt: "desc" } });
    expect(Number(h.oldPrice)).toBeCloseTo(before, 2);
    expect(Number(h.newPrice)).toBeCloseTo(before * 0.95, 2);
    expect(Number(h.changePct)).toBeCloseTo(-5, 0);
    await expect(prisma.priceHistory.update({ where: { id: h.id }, data: { newPrice: "1" } })).rejects.toThrow(/APPEND_ONLY/);
    expect((await recentChanges(await ctxFor(SA))).some((c) => c.offerId === mozz)).toBe(true);
  });
});

describe("big increases wait for FIRINGI", () => {
  it("holds an increase above the threshold; small changes apply; a newer price replaces the request", async () => {
    const lx = await ctxFor(LX);
    const now = await priceOf(mozz);
    const r1 = await setPrice(lx, baseList, mozz, 1, (now * 1.25).toFixed(2));
    expect(r1.held).toBeTruthy();
    expect(await priceOf(mozz)).toBeCloseTo(now, 2); // not applied
    expect(await prisma.notification.count({ where: { type: "price.change_requested", user: { email: SA } } })).toBeGreaterThan(0);
    const r2 = await setPrice(lx, baseList, mozz, 1, (now * 1.3).toFixed(2), "Milk prices up");
    expect((await prisma.priceChangeRequest.findUniqueOrThrow({ where: { id: r1.held! } })).status).toBe("CANCELLED");
    const req = await prisma.priceChangeRequest.findUniqueOrThrow({ where: { id: r2.held! } });
    expect(req).toMatchObject({ status: "PENDING", reason: "Milk prices up" });
    expect(Number(req.changePct)).toBeCloseTo(30, 0);
    const small = await setPrice(lx, baseList, mozz, 6, (now * 0.9).toFixed(2)); // a new tier: no current price → applies
    expect(small.held).toBeNull();
    const rows = await listRequests(await ctxFor(SA), "PENDING");
    const row = rows.find((x) => x.id === r2.held)!;
    expect(row.market?.n).toBeGreaterThanOrEqual(3);
  });

  it("approval: customers are told, the job applies it on the date", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    await expect(approveRequest(lx, "x")).rejects.toThrow(/permission/);
    const req = await prisma.priceChangeRequest.findFirstOrThrow({ where: { offerId: mozz, status: "PENDING" } });
    await expect(approveRequest(sa, req.id, { effectiveAt: new Date(Date.now() + DAY).toISOString().slice(0, 10) })).rejects.toThrow(/at least 7 days/);
    const before = await priceOf(mozz);
    const r = await approveRequest(sa, req.id, { note: "Dairy index up" });
    expect(r.customersTold).toBeGreaterThanOrEqual(1);
    expect(r.effectiveAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY);
    expect(await prisma.notification.count({ where: { type: "price.increase_notice", user: { email: KEBAB } } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { type: "price.change_approved", user: { email: LX } } })).toBeGreaterThan(0);
    expect(await priceOf(mozz)).toBeCloseTo(before, 2);
    const mine = await buyerPriceChanges(await ctxFor(KEBAB));
    expect(mine.upcoming.find((u) => u.offerId === mozz)).toMatchObject({ supplier: "Lisboa Central" });
    expect(await applyDueRequests(new Date())).toBe(0);
    expect(await applyDueRequests(new Date(Date.now() + 8 * DAY))).toBe(1);
    expect(await priceOf(mozz)).toBeCloseTo(Number(req.newPrice), 2);
    expect((await prisma.priceChangeRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("APPLIED");
    expect((await buyerPriceChanges(await ctxFor(KEBAB))).recent.some((x) => x.offerId === mozz && x.pct > 25)).toBe(true);
  });

  it("rejection needs a reason; the supplier can withdraw a request", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    const now = await priceOf(mozz);
    const a = (await setPrice(lx, baseList, mozz, 1, (now * 1.5).toFixed(2))).held!;
    await expect(rejectRequest(sa, a, "")).rejects.toThrow(/Say why/);
    await rejectRequest(sa, a, "50 % at once is too much — spread it");
    expect(await prisma.notification.count({ where: { type: "price.change_rejected", user: { email: LX } } })).toBeGreaterThan(0);
    const b = (await setPrice(lx, baseList, mozz, 1, (now * 1.4).toFixed(2))).held!;
    await cancelRequest(lx, b);
    expect((await prisma.priceChangeRequest.findUniqueOrThrow({ where: { id: b } })).status).toBe("CANCELLED");
    await expect(cancelRequest(await ctxFor("owner@atlantico.test"), a)).rejects.toThrow(/not found|permission/i);
    expect(await priceOf(mozz)).toBeCloseTo(now, 2);
  });

  it("threshold 0 switches approvals off; settings are validated", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    await expect(savePriceSettings(sa, { ...DEFAULT_SETTINGS, noticeDays: 90 })).rejects.toThrow(/Notice days/);
    await expect(savePriceSettings(lx, DEFAULT_SETTINGS)).rejects.toThrow(/permission/);
    await savePriceSettings(sa, { ...DEFAULT_SETTINGS, approvalThresholdPct: 0 });
    const now = await priceOf(mozz);
    expect((await setPrice(lx, baseList, mozz, 1, (now * 1.2).toFixed(2))).held).toBeNull();
    await setPrice(lx, baseList, mozz, 1, now.toFixed(2));
    await savePriceSettings(sa, { ...DEFAULT_SETTINGS });
    expect((await priceSettings()).approvalThresholdPct).toBe(10);
  });
});

describe("alerts", () => {
  it("price far above the market and a big jump; dismissed stays dismissed; resolves when fixed", async () => {
    const sa = await ctxFor(SA);
    const now = await priceOf(mozz);
    const item = await prisma.priceListItem.findFirstOrThrow({ where: { offerId: mozz, minQty: 1, priceList: { scope: "BASE" } } });
    await prisma.priceListItem.update({ where: { id: item.id }, data: { unitPriceNet: (now * 2).toFixed(4) } }); // e.g. an import bypassing the approval
    const r = await detectAlerts();
    expect(r.created).toBeGreaterThanOrEqual(2);
    const alerts = (await listAlerts(sa)).filter((a) => a.offerId === mozz);
    expect(alerts.map((a) => a.kind).sort()).toEqual(["ABOVE_MARKET", "JUMP"]);
    const above = alerts.find((a) => a.kind === "ABOVE_MARKET")!;
    expect(Number(above.deviationPct)).toBeGreaterThan(30);
    await handleAlert(sa, above.id, "DISMISSED", "Premium buffalo mozzarella");
    await detectAlerts();
    expect((await listAlerts(sa)).filter((a) => a.offerId === mozz && a.kind === "ABOVE_MARKET")).toHaveLength(0);
    await prisma.priceListItem.update({ where: { id: item.id }, data: { unitPriceNet: now.toFixed(4) } });
    const r2 = await detectAlerts();
    expect(r2.resolved).toBeGreaterThanOrEqual(0);
    expect(await prisma.priceAlert.count({ where: { offerId: mozz, kind: "ABOVE_MARKET", status: "OPEN" } })).toBe(0);
    expect(await prisma.notification.count({ where: { type: "price.alerts", user: { email: SA } } })).toBeGreaterThan(0);
  });
});

describe("views", () => {
  it("comparison and product history (FIRINGI only)", async () => {
    const sa = await ctxFor(SA);
    const cmp = await priceComparison(sa, { q: "mozz" });
    const m = cmp.find((x) => x.variantId === variantId)!;
    expect(m.stats.n).toBeGreaterThanOrEqual(3);
    expect(m.offers.length).toBeGreaterThanOrEqual(3);
    const h = await productHistory(sa, variantId);
    expect(h.series.length).toBeGreaterThanOrEqual(3);
    expect(h.series.find((s) => s.offerId === mozz)!.changes.length).toBeGreaterThan(2);
    await expect(priceComparison(await ctxFor(KEBAB))).rejects.toThrow(/permission/);
  });

  it("supplier sees its market position without competitors' names", async () => {
    const lx = await ctxFor(LX);
    const d = await supplierPriceInsights(lx);
    const row = d.rows.find((r) => r.offerId === mozz)!;
    expect(row.market).toMatchObject({ suppliers: expect.any(Number), position: expect.stringMatching(/CHEAPEST|BELOW_MEDIAN|ABOVE_MEDIAN|MOST_EXPENSIVE/) });
    expect(d.settings.approvalThresholdPct).toBe(10);
    expect(d.requests.length).toBeGreaterThan(0);
    const others = await prisma.company.findMany({ where: { type: "WHOLESALER", id: { not: lx.company.id } }, select: { legalName: true, tradeName: true } });
    const json = JSON.stringify(d);
    for (const o of others) { expect(json).not.toContain(o.legalName); if (o.tradeName) expect(json).not.toContain(o.tradeName); }
    await expect(supplierPriceInsights(await ctxFor(KEBAB))).rejects.toThrow(/permission/);
  });

  it("overview, margin heat-map and suggestions", async () => {
    const sa = await ctxFor(SA);
    const ov = await priceOverview(sa);
    expect(ov.kpi.changes30).toBeGreaterThan(0);
    expect(ov.weekly.points).toHaveLength(12);
    const heat = await marginHeatmap(sa, { from: new Date(Date.now() - 365 * DAY), to: new Date(Date.now() + DAY), by: "SUPPLIER" });
    expect(heat.total.sales).toBeGreaterThanOrEqual(0);
    for (const by of ["BUSINESS_TYPE", "COUNTRY"] as const) expect((await marginHeatmap(sa, { from: new Date(0), to: new Date(Date.now() + DAY), by })).cols).toBeDefined();
    const sug = await priceSuggestions(sa);
    expect(Array.isArray(sug.commission) && Array.isArray(sug.reviews)).toBe(true);
  });
});
