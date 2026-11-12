/**
 * Phase 30: demand planning & restock.
 *  • The nightly run stores next weeks' forecasts, back-tests new series (accuracy from day one),
 *    and keeps one restock suggestion per product × warehouse.
 *  • Lead times are measured from received purchase orders; the supplier can plan with the stated one.
 *  • Ordering suggestions drafts purchase orders (nothing is sent); drafts count as incoming, so the
 *    suggestion doesn't come back. A dismissed suggestion stays away until its snooze date.
 *  • Events move the forecast; short-dated stock that won't sell in time shows as expiry risk.
 *  • FIRINGI sees every supplier's risk and can ask a supplier to restock (at most every 3 days).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { seedDemoHistory } from "../../prisma/seed/history";
import { receive, setOnHand } from "@/server/inventory/ledger";
import {
  accuracyOf, adminOverview, adminStockoutRisk, dismissSuggestion, flagSupplier, forecastDetail, myLeadTimes, myPlan, myRisk, mySuggestions,
  orderSuggestions, recalculate, runPlanning, saveCompanySettings, saveItem, saveMyEvent, setUseMeasured,
} from "@/server/planning/service";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", ATL = "owner@atlantico.test", KEBAB = "owner@kebabhouse.test";
const DAY = 86_400_000;
let historyIds: string[] = [], companyId = "", wh = "", kebab = "", flour = "", mozz = "", supplierId = "";
const before = new Map<string, number>();

beforeAll(async () => {
  const pre = new Set((await prisma.order.findMany({ where: { buyerNotes: "Demo history" }, select: { id: true } })).map((o) => o.id));
  await seedDemoHistory(prisma, new Date(), { statusHistory: false });
  historyIds = (await prisma.order.findMany({ where: { buyerNotes: "Demo history" }, select: { id: true } })).map((o) => o.id).filter((id) => !pre.has(id));
  const atl = await ctxFor(ATL);
  companyId = atl.company.id;
  const o = await prisma.order.findFirstOrThrow({ where: { id: { in: historyIds }, sellerCompanyId: companyId } });
  wh = o.sourceAddressId!;
  const offer = async (sku: string) => (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: companyId, vendorSku: sku } })).id;
  [kebab, flour, mozz] = await Promise.all(["DIS-KEBAB10", "DIS-FARINHA25", "DIS-MOZZ2"].map(offer));
  for (const id of [kebab, flour, mozz]) before.set(id, (await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: id, addressId: wh } } }))?.onHand ?? 0);
  // a cold-chain supplier that promises 2 days and takes 6
  const s = await prisma.purchaseSupplier.create({ data: { ownerCompanyId: companyId, name: "P30 Frio Lda", leadTimeDays: 2 } });
  supplierId = s.id;
  for (const ago of [40, 30, 20]) {
    const sentAt = new Date(Date.now() - ago * DAY);
    await prisma.purchaseOrder.create({
      data: {
        ownerCompanyId: companyId, number: `PO-P30-${ago}`, supplierId, addressId: wh, status: "RECEIVED", sentAt, receivedAt: new Date(sentAt.getTime() + 6 * DAY), expectedOn: new Date(sentAt.getTime() + 2 * DAY),
        createdById: atl.user.id, lines: { create: [{ offerId: kebab, description: "kebab", qty: 50, receivedQty: 50, unitCost: 40 }] }, receipts: { create: [{ at: new Date(sentAt.getTime() + 6 * DAY), byUserId: atl.user.id }] },
      },
    });
  }
  await prisma.$transaction(async (tx) => {
    // free stock = on hand − reserved (earlier test files may leave open orders reserving some)
    const reserved = async (offerId: string) => (await tx.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh } } }))?.reserved ?? 0;
    await setOnHand(tx, { offerId: kebab, addressId: wh, onHand: (await reserved(kebab)) + 10 });
    await setOnHand(tx, { offerId: flour, addressId: wh, onHand: await reserved(flour) });
    await receive(tx, { offerId: mozz, addressId: wh, qty: 300, unitCost: 50, lotCode: "P30-SHORT", expiresOn: new Date(Date.now() + 5 * DAY), source: "RECEIPT", type: "RECEIPT" });
  });
});

afterAll(async () => {
  await prisma.restockSuggestion.deleteMany({ where: { companyId } });
  await prisma.demandForecast.deleteMany({ where: { companyId } });
  await prisma.planningItem.deleteMany({ where: { offer: { vendorCompanyId: companyId } } });
  await prisma.planningEvent.deleteMany({ where: { companyId } });
  await prisma.planningSettings.deleteMany({ where: { companyId } });
  const pos = await prisma.purchaseOrder.findMany({ where: { ownerCompanyId: companyId, OR: [{ supplierId }, { status: "DRAFT" }] }, select: { id: true } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: pos.map((p) => p.id) } } });
  await prisma.purchaseSupplier.deleteMany({ where: { id: supplierId } });
  await prisma.$transaction(async (tx) => { for (const [offerId, onHand] of before) await setOnHand(tx, { offerId, addressId: wh, onHand }); });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: historyIds } } });
  await prisma.order.deleteMany({ where: { id: { in: historyIds } } });
});

describe("demand planning", () => {
  it("the nightly run stores forecasts (future + back-tested past) and suggests restocking", async () => {
    const r = await runPlanning({ companyId, notify: false });
    expect(r.companies).toBe(1);
    expect(r.series).toBeGreaterThan(3);
    const future = await prisma.demandForecast.count({ where: { companyId, weekStart: { gt: new Date() } } });
    const past = await prisma.demandForecast.findMany({ where: { companyId, backtest: true } });
    expect(future).toBeGreaterThan(10);
    expect(past.length).toBeGreaterThan(5);
    expect(past.every((p) => p.actual !== null && p.qty >= 0 && p.low <= p.qty && p.high >= p.qty)).toBe(true);
    const acc = await accuracyOf(companyId);
    expect(acc.overall.accuracyPct).not.toBeNull();
    expect(acc.weeks.length).toBeGreaterThan(2);

    const open = await mySuggestions(await ctxFor(ATL));
    const k = open.find((s) => s.offerId === kebab)!;
    const f = open.find((s) => s.offerId === flour)!;
    expect(f.urgency).toBe("OUT");
    expect(["LATE", "ORDER_NOW", "OUT"]).toContain(k.urgency);
    expect(k.qty).toBeGreaterThan(0);
    expect(k.supplierId).toBe(supplierId); // from its last purchase order
    expect(k.leadTimeDays).toBe(6); // measured, not the 2 promised
    // run again: same suggestion updated, not duplicated
    await runPlanning({ companyId, notify: false });
    expect(await prisma.restockSuggestion.count({ where: { companyId, offerId: kebab, status: "OPEN" } })).toBe(1);
  });

  it("lead times: measured from receipts; the supplier can plan with the stated one instead", async () => {
    const atl = await ctxFor(ATL);
    const lt = (await myLeadTimes(atl)).find((s) => s.id === supplierId)!;
    expect(lt.stats).toMatchObject({ orders: 3, measured: 6, onTimePct: 0 });
    expect(lt.basis).toBe("MEASURED");
    await setUseMeasured(atl, supplierId, false);
    const row = (await myPlan(atl)).rows.find((r) => r.offerId === kebab && r.addressId === wh)!;
    expect(row.leadTimeDays).toBe(2);
    await setUseMeasured(atl, supplierId, true);
  });

  it("planning choices: minimum and multiples shape the quantity; bad input is refused", async () => {
    const atl = await ctxFor(ATL);
    await expect(saveItem(atl, { offerId: kebab, addressId: wh, minOrderQty: 0, packMultiple: 1, excluded: false })).rejects.toThrow(/Minimum order/);
    await saveItem(atl, { offerId: kebab, addressId: wh, minOrderQty: 100, packMultiple: 25, supplierId, unitCost: 39.5, excluded: false });
    const row = (await myPlan(atl)).rows.find((r) => r.offerId === kebab && r.addressId === wh)!;
    expect(row.plan.qty % 25).toBe(0);
    expect(row.plan.qty).toBeGreaterThanOrEqual(100);
    expect(row.unitCost).toBe(39.5);
    await saveCompanySettings(atl, { serviceLevel: 99, reviewDays: 14, overstockDays: null });
    const hi = (await myPlan(atl)).rows.find((r) => r.offerId === kebab && r.addressId === wh)!;
    expect(hi.plan.safetyStock).toBeGreaterThan(row.plan.safetyStock);
    await saveCompanySettings(atl, { serviceLevel: null, reviewDays: null, overstockDays: null });
  });

  it("an event moves the forecast", async () => {
    const atl = await ctxFor(ATL);
    const base = (await forecastDetail(atl, kebab, wh)).row.forecast[1];
    const d = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
    await expect(saveMyEvent(atl, { name: "Bad", startsOn: d(5), endsOn: d(1), upliftPct: 20 })).rejects.toThrow(/end/);
    await saveMyEvent(atl, { name: "Kebab week", startsOn: d(-7), endsOn: d(60), upliftPct: 50, offerIds: [kebab] });
    const up = (await forecastDetail(atl, kebab, wh)).row.forecast[1];
    expect(up).toBeGreaterThan(base * 1.3);
    await prisma.planningEvent.deleteMany({ where: { companyId } });
  });

  it("ordering drafts purchase orders; drafts count as incoming so the suggestion doesn't come back", async () => {
    const atl = await ctxFor(ATL);
    await runPlanning({ companyId, notify: false });
    const open = await mySuggestions(atl);
    const k = open.find((s) => s.offerId === kebab)!;
    const made = await orderSuggestions(atl, [{ id: k.id, qty: k.qty }]);
    expect(made).toHaveLength(1);
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: made[0].id }, include: { lines: true } });
    expect(po.status).toBe("DRAFT");
    expect(po.supplierId).toBe(supplierId);
    expect(po.lines[0]).toMatchObject({ offerId: kebab, qty: k.qty });
    expect((await prisma.restockSuggestion.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("ORDERED");
    await runPlanning({ companyId, notify: false });
    expect(await prisma.restockSuggestion.count({ where: { companyId, offerId: kebab, status: "OPEN" } })).toBe(0);
    await expect(orderSuggestions(atl, [{ id: k.id, qty: 1 }])).rejects.toThrow(/changed/);
  });

  it("a dismissed suggestion stays away until its snooze date", async () => {
    const atl = await ctxFor(ATL);
    const f = (await mySuggestions(atl)).find((s) => s.offerId === flour)!;
    await dismissSuggestion(atl, f.id, { reason: "Discontinued", snoozeDays: 14 });
    await recalculate(atl);
    expect(await prisma.restockSuggestion.count({ where: { companyId, offerId: flour, status: "OPEN" } })).toBe(0);
  });

  it("short-dated stock that won't sell in time is an expiry risk with a markdown suggestion", async () => {
    const r = await myRisk(await ctxFor(ATL));
    const line = r.rows.find((x) => x.kind === "EXPIRY" && x.offerId === mozz && x.batch?.lotCode === "P30-SHORT")!;
    expect(line.units).toBeGreaterThan(200);
    expect(line.action.kind).toBe("MARKDOWN");
    expect(line.value).toBeGreaterThan(0);
  });

  it("FIRINGI: overview, stock-out risk across suppliers, asking a supplier to restock (once in 3 days)", async () => {
    const sa = await ctxFor(SA);
    const ov = await adminOverview(sa);
    expect(ov.suppliers.find((s) => s.id === companyId)!.products).toBeGreaterThan(3);
    await runPlanning({ companyId, notify: false });
    // un-dismiss to have an OUT line again
    await prisma.restockSuggestion.updateMany({ where: { companyId, status: "DISMISSED" }, data: { snoozeUntil: null } });
    await runPlanning({ companyId, notify: false });
    const risk = await adminStockoutRisk(sa);
    const line = risk.find((x) => x.companyId === companyId && x.offerId === flour)!;
    expect(line.urgency).toBe("OUT");
    await flagSupplier(sa, line.id, "Customers are asking for it");
    await expect(flagSupplier(sa, line.id)).rejects.toThrow(/already asked/);
    expect((await adminStockoutRisk(sa)).find((x) => x.id === line.id)!.flaggedAt).not.toBeNull();
  });

  it("only the supplier's own staff and FIRINGI see planning", async () => {
    await expect(myPlan(await ctxFor(KEBAB))).rejects.toThrow();
    await expect(adminOverview(await ctxFor(ATL))).rejects.toThrow();
  });
});
