/**
 * Phase 17: AI insights from FIRINGI's own data — demand forecast, stock-out, reorder timing,
 * better suppliers, margin gaps, delivery risk — each scoped to who asks; the suggestions feed
 * (accept = CRM call task / stock notice to the supplier; dismiss), and the AI activity log.
 * Uses 16 weeks of demo buying history, removed again afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { seedDemoHistory } from "../../prisma/seed/history";
import { deliveryRisk, demandForecast, marginOpportunities, reorderPredictions, stockPredictions, supplierRecommendations } from "@/server/ai/insights";
import { decideRecommendation, listActivity, listRecommendations, refreshRecommendations } from "@/server/ai/feed";
import { removeMarginRule, saveMarginRule } from "@/server/services/performance";
import { ctxFor, companyId, setAiRole } from "../helpers";

const SA = "superadmin@firingi.test", SALES = "sales@firingi.test", OPS = "ops@firingi.test", SUPPORT = "support@firingi.test";
const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", ATL = "owner@atlantico.test";
let historyIds: string[] = [];
let drainedOfferId = ""; // the Atlântico product whose stock the stock test sets to 3
let ruleId: string | null = null;
const stockBackup: { id: string; onHand: number }[] = [];

beforeAll(async () => {
  const before = new Set((await prisma.order.findMany({ where: { buyerNotes: "Demo history" }, select: { id: true } })).map((o) => o.id));
  await seedDemoHistory(prisma, new Date(), { statusHistory: false });
  historyIds = (await prisma.order.findMany({ where: { buyerNotes: "Demo history" }, select: { id: true } })).map((o) => o.id).filter((id) => !before.has(id));
  // The AI Centre is Super Admin only by default: the other staff here get it through a role.
  await setAiRole(OPS, true); await setAiRole(SALES, true);
});

afterAll(async () => {
  await setAiRole(OPS, false); await setAiRole(SALES, false);
  for (const s of stockBackup) await prisma.stockLevel.update({ where: { id: s.id }, data: { onHand: s.onHand } });
  if (ruleId) await removeMarginRule(await ctxFor(SA), ruleId).catch(() => {});
  await prisma.aiRecommendation.deleteMany({});
  await prisma.order.deleteMany({ where: { id: { in: historyIds } } });
  await prisma.$disconnect();
});

describe("who gets the AI Centre", () => {
  it("Super Admin by default; other staff only through a role with the AI right; never suppliers or customers", async () => {
    await setAiRole(SALES, false);
    await expect(demandForecast(await ctxFor(SALES), "STAFF")).rejects.toThrow(); // Sales role alone: no AI Centre
    await expect(demandForecast(await ctxFor(SUPPORT), "STAFF")).rejects.toThrow();
    await expect(demandForecast(await ctxFor(SA), "STAFF")).resolves.toBeDefined();
    await setAiRole(SALES, true);
    await expect(demandForecast(await ctxFor(SALES), "STAFF")).resolves.toBeDefined(); // granted by role
    await expect(demandForecast(await ctxFor(KEBAB), "STAFF")).rejects.toThrow();
  });
});

describe("who may see AI insights", () => {
  it("staff need the AI right and the data right; buyers and suppliers only their own", async () => {
    await expect(demandForecast(await ctxFor(SUPPORT), "STAFF")).rejects.toThrow(); // no AI right
    await expect(marginOpportunities(await ctxFor(OPS))).rejects.toThrow(); // AI right, but no finance / pricing
    await expect(marginOpportunities(await ctxFor(SALES))).resolves.toBeDefined();
    await expect(demandForecast(await ctxFor(KEBAB), "STAFF")).rejects.toThrow();
    await expect(demandForecast(await ctxFor(KEBAB), "VENDOR")).rejects.toThrow(); // a restaurant sells nothing
    await expect(stockPredictions(await ctxFor(KEBAB), "VENDOR")).rejects.toThrow();
  });
});

describe("insights", () => {
  it("demand forecast follows the trend; a supplier sees only its own products", async () => {
    const atl = await ctxFor(ATL);
    const rows = await demandForecast(atl, "VENDOR");
    expect(rows.length).toBeGreaterThan(0);
    const own = new Set((await prisma.vendorOffer.findMany({ where: { vendorCompanyId: atl.company.id }, select: { id: true } })).map((o) => o.id));
    expect(rows.every((r) => own.has(r.offerId))).toBe(true);
    for (const r of rows) { expect(r.history).toHaveLength(12); expect(r.forecast).toHaveLength(4); expect(r.forecast.every((v) => v >= 0)).toBe(true); }
    expect(rows.some((r) => (r.trend ?? 0) > 0.05)).toBe(true); // one of the growing products
    const staff = await demandForecast(await ctxFor(SA), "STAFF");
    expect(staff.length).toBeGreaterThan(rows.length);
  });

  it("reorder timing: C&C Almada stopped buying from Atlântico — overdue, with its usual basket", async () => {
    const cc = await companyId("Cash & Carry Almada, Lda"), atlId = await companyId("Distribuidora Atlântico, Lda");
    const rows = await reorderPredictions(await ctxFor(SA), "STAFF", { onlyDue: true });
    const r = rows.find((x) => x.buyerId === cc && x.sellerId === atlId)!;
    expect(r).toBeTruthy();
    expect(r.gapDays).toBeGreaterThanOrEqual(6);
    expect(r.gapDays).toBeLessThanOrEqual(8);
    expect(r.overdueDays).toBeGreaterThanOrEqual(9);
    expect(r.basket.length).toBeGreaterThan(0);
    expect(r.basket.every((b) => b.qty > 0)).toBe(true);
    // the buyer sees only its own suppliers; the supplier only its own customers
    const kebab = await ctxFor(KEBAB);
    const mine = await reorderPredictions(kebab, "BUYER");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x) => x.buyerId === kebab.company.id)).toBe(true);
    const atl = await ctxFor(ATL);
    expect((await reorderPredictions(atl, "VENDOR")).every((x) => x.sellerId === atl.company.id)).toBe(true);
  });

  it("stock prediction: low stock on a product that sells → runs out soon", async () => {
    const atl = await ctxFor(ATL);
    const top = (await demandForecast(atl, "VENDOR"))[0];
    drainedOfferId = top.offerId;
    const levels = await prisma.stockLevel.findMany({ where: { offerId: top.offerId } });
    expect(levels.length).toBeGreaterThan(0);
    for (const l of levels) { stockBackup.push({ id: l.id, onHand: l.onHand }); await prisma.stockLevel.update({ where: { id: l.id }, data: { onHand: l.reserved + (l === levels[0] ? 3 : 0) } }); }
    const rows = await stockPredictions(atl, "VENDOR", { onlyAtRisk: true });
    const r = rows.find((x) => x.offerId === top.offerId)!;
    expect(r.status).toBe("CRITICAL");
    expect(r.available).toBe(3);
    expect(r.days).toBeLessThan(7);
    expect(rows.every((x) => x.vendorId === atl.company.id)).toBe(true);
  });

  it("supplier recommendations: the same product cheaper (with stock) elsewhere", async () => {
    const rows = await supplierRecommendations(await ctxFor(SA));
    for (const r of rows) {
      expect(r.currentOfferId).not.toBe(r.betterOfferId);
      if (r.reason !== "BETTER_SERVICE") expect(r.betterPrice).toBeLessThan(r.currentPrice);
      expect(r.betterStock).toBeGreaterThanOrEqual(r.weeklyUnits);
    }
    await expect(supplierRecommendations(await ctxFor(SUPPORT))).rejects.toThrow();
  });

  it("margin opportunities: offers below the target, sized in € a year", async () => {
    const sa = await ctxFor(SA);
    const r = await saveMarginRule(sa, { scope: "GLOBAL", minMarginPercent: 1, targetMarginPercent: 60, note: "AI test" });
    ruleId = r.id;
    const rows = await marginOpportunities(sa);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.margin < x.goal)).toBe(true);
    const sold = rows.filter((x) => x.netLast8Weeks > 0);
    expect(sold.length).toBeGreaterThan(0);
    expect(sold[0].yearlyGap).toBeGreaterThan(0);
    expect(rows[0].yearlyGap).toBeGreaterThanOrEqual(rows[rows.length - 1].yearlyGap);
  });

  it("delivery risk: an order nobody confirmed for a day, due tomorrow", async () => {
    const lx = await ctxFor(LX);
    const o = await prisma.order.findFirst({ where: { sellerCompanyId: lx.company.id, status: "PENDING_CONFIRMATION" } })
      ?? await prisma.order.create({
        data: {
          ...(await (async () => { const h = await prisma.order.findFirstOrThrow({ where: { id: { in: historyIds }, sellerCompanyId: lx.company.id } }); return { flow: h.flow, buyerCompanyId: h.buyerCompanyId, sellerCompanyId: h.sellerCompanyId, placedByUserId: h.placedByUserId, countryId: h.countryId, deliveryAddress: h.deliveryAddress as object }; })()),
          number: `FO-TEST-${Date.now()}`, status: "PENDING_CONFIRMATION", buyerNotes: "Demo history",
        },
      });
    if (!historyIds.includes(o.id) && o.buyerNotes === "Demo history") historyIds.push(o.id);
    const keep = { placedAt: o.placedAt, requestedDeliveryDate: o.requestedDeliveryDate };
    await prisma.order.update({ where: { id: o.id }, data: { placedAt: new Date(Date.now() - 30 * 3600_000), requestedDeliveryDate: new Date(Date.now() - 2 * 86400_000) } });
    try {
      const rows = await deliveryRisk(lx, "VENDOR");
      const r = rows.find((x) => x.orderId === o.id)!;
      expect(r.level).toBe("HIGH");
      expect(r.reasons).toEqual(expect.arrayContaining([{ code: "NOT_CONFIRMED", n: 30 }, { code: "DATE_PASSED" }]));
      expect(rows.every((x) => x.seller.length > 0)).toBe(true);
      // staff see it too
      expect((await deliveryRisk(await ctxFor(OPS), "STAFF")).some((x) => x.orderId === o.id)).toBe(true);
    } finally {
      await prisma.order.update({ where: { id: o.id }, data: keep });
    }
  });
});

describe("suggestions feed", () => {
  it("refresh creates suggestions for staff, suppliers and buyers — once per situation", async () => {
    const r1 = await refreshRecommendations();
    expect(r1.created).toBeGreaterThan(0);
    const r2 = await refreshRecommendations();
    expect(r2.created).toBe(0); // same situations → updated, not duplicated
    const sa = await ctxFor(SA);
    const staff = await listRecommendations(sa, "STAFF");
    expect(staff.some((x) => x.kind === "REORDER_DUE")).toBe(true);
    const kebab = await ctxFor(KEBAB);
    const mine = await listRecommendations(kebab, "BUYER");
    expect(mine.every((x) => x.companyId === kebab.company.id && x.audience === "BUYER")).toBe(true);
    const atl = await ctxFor(ATL);
    expect((await listRecommendations(atl, "VENDOR")).some((x) => x.kind === "STOCK_OUT")).toBe(true); // the product set to 3 units above
  });

  it("accepting a late reorder creates a CRM call task; others can't touch someone else's suggestion", async () => {
    const sales = await ctxFor(SALES);
    const rec = (await listRecommendations(sales, "STAFF", { kind: "REORDER_DUE" }))[0];
    expect(rec).toBeTruthy();
    const res = await decideRecommendation(sales, rec.id, true);
    expect(res.status).toBe("ACCEPTED");
    const task = await prisma.crmTask.findUniqueOrThrow({ where: { id: String(res.result.taskId) } });
    expect(task.kind).toBe("FOLLOW_UP");
    expect(task.title).toMatch(/^Call /);
    await expect(decideRecommendation(sales, rec.id, false)).rejects.toThrow(/already/);
    await prisma.crmTask.delete({ where: { id: task.id } });

    const buyerRec = (await listRecommendations(await ctxFor(KEBAB), "BUYER"))[0];
    if (buyerRec) await expect(decideRecommendation(await ctxFor(LX), buyerRec.id, false)).rejects.toThrow();
  });

  it("accepting a stock warning notifies the supplier; dismissed stays dismissed", async () => {
    const sa = await ctxFor(SA);
    const stock = (await listRecommendations(sa, "STAFF", { kind: "STOCK_OUT" })).find((r) => r.subjectId === drainedOfferId)!;
    expect(stock).toBeTruthy();
    const res = await decideRecommendation(sa, stock.id, true);
    expect(Number(res.result.notified)).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { type: "ai.stock_low", user: { email: ATL } } })).toBeGreaterThan(0);

    const other = (await listRecommendations(sa, "STAFF"))[0];
    await decideRecommendation(sa, other.id, false, "Not now");
    await refreshRecommendations();
    expect((await prisma.aiRecommendation.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("DISMISSED");
  });

  it("the activity log records refreshes and decisions", async () => {
    const log = await listActivity(await ctxFor(SA));
    const kinds = new Set(log.rows.map((r) => r.kind));
    expect(kinds.has("REFRESH") && kinds.has("ACCEPT") && kinds.has("DISMISS")).toBe(true);
    await expect(listActivity(await ctxFor(SUPPORT))).rejects.toThrow();
  });
});
