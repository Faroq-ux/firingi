/**
 * Phase 14: profit & finance insight — P&L, cash flow, net profit, route profitability,
 * margin rules (also in supplier allocation), contract pricing, ratings, scorecards, KPIs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { cashFlow, deleteCost, netProfitBy, profitAndLoss, routeProfitability, saveCost } from "@/server/services/profit";
import {
  contractPricing, kpiBoard, listMarginRules, listRatings, marginFloor, marginWatch, moderateRating, rateOrder, removeMarginRule, replyRating, saveMarginRule, setKpiTarget, supplierScorecards,
} from "@/server/services/performance";
import { ctxFor } from "../helpers";

const FIN = "finance@firingi.test";
const SA = "superadmin@firingi.test";
const KEBAB = "owner@kebabhouse.test";
const LX = "owner@lisboacentral.test";
let deliveredOrderId = "";

/** Kebab House orders from Lisboa Central; the supplier delivers it (→ invoiced). */
async function deliveredOrder(qty = 30) {
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await clearCart(kebab);
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
  await confirmOrder(lx, id, {});
  for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (o.status !== "DELIVERED") await changeOrderStatus(lx, id, st).catch(() => {});
  }
  expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("DELIVERED");
  return id;
}

beforeAll(async () => { deliveredOrderId = await deliveredOrder(); });
afterAll(() => prisma.$disconnect());

describe("profit & loss, costs, cash flow", () => {
  it("P&L adds up; a recorded cost lowers net profit by exactly its amount; monthly costs repeat", async () => {
    const fin = await ctxFor(FIN);
    const before = await profitAndLoss(fin, { months: 3 });
    const now = before.rows[before.rows.length - 1];
    expect(now.revenue).toBeGreaterThan(0);
    expect(now.orders).toBeGreaterThan(0);
    for (const r of before.rows) {
      expect(r.gross).toBeCloseTo(r.revenue - r.cogs - r.credits + r.vendorCredits, 1);
      expect(r.net).toBeCloseTo(r.gross - r.driverPay - r.absorbed - r.costTotal, 1);
    }
    const twoMonthsAgo = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 5));
    const rent = await saveCost(fin, null, { date: twoMonthsAgo, monthly: true, category: "WAREHOUSE", description: "Armazém rent", amountNet: 1000, vatAmount: 230 });
    const once = await saveCost(fin, null, { date: new Date(), category: "MARKETING", description: "Flyers", amountNet: 120 });
    const after = await profitAndLoss(fin, { months: 3 });
    expect(after.rows.map((r) => r.costs.WAREHOUSE ?? 0)).toEqual([1000, 1000, 1000]);
    expect(after.rows[2].net).toBeCloseTo(now.net - 1120, 1);
    expect(after.total.costs.MARKETING).toBe(120);
    await expect(saveCost(await ctxFor("sales@firingi.test"), null, { date: new Date(), category: "OTHER", description: "x", amountNet: 1 })).rejects.toThrow();
    await expect(profitAndLoss(await ctxFor(KEBAB))).rejects.toThrow();

    const cf = await cashFlow(fin, { months: 3, weeksAhead: 6 });
    expect(cf.rows[2].costs).toBeGreaterThanOrEqual(1230 + 120);
    expect(cf.forecast).toHaveLength(6);
    expect(cf.forecast.reduce((a, w) => a + w.receivable, 0) + cf.overdueReceivable).toBeGreaterThan(0); // the delivered order's invoice is open
    expect(cf.forecast.some((w) => w.costs >= 1230)).toBe(true); // next month's rent
    await deleteCost(fin, rent.id); await deleteCost(fin, once.id);
  });

  it("net profit by supplier / customer / country; route profitability adds up", async () => {
    const fin = await ctxFor(FIN);
    const p = { from: new Date(Date.now() - 30 * 86400_000), to: new Date() };
    const byVendor = await netProfitBy(fin, "vendor", p);
    const lx = byVendor.find((r) => r.name === "Lisboa Central")!;
    expect(lx.orders).toBeGreaterThan(0);
    expect(lx.net).toBeLessThanOrEqual(lx.margin + lx.fees + 0.01);
    expect((await netProfitBy(fin, "buyer", p)).some((r) => r.name === "Kebab House")).toBe(true);
    expect((await netProfitBy(fin, "country", p)).some((r) => r.name.includes("PT"))).toBe(true);
    for (const r of await routeProfitability(fin, p)) {
      expect(r.cost).toBeCloseTo(r.driverPay + r.vehicle, 1);
      expect(r.totalProfit).toBeCloseTo(r.fees + r.margin - r.cost, 1);
    }
  });
});

describe("margin rules", () => {
  it("most specific rule wins; offers below the floor are flagged; supplier allocation uses the floor", async () => {
    const sa = await ctxFor(SA);
    const cca = await prisma.company.findFirstOrThrow({ where: { legalName: "Cash & Carry Almada, Lda" } });
    const pt = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
    await saveMarginRule(sa, { scope: "GLOBAL", minMarginPercent: 2, targetMarginPercent: 6 });
    await saveMarginRule(sa, { scope: "VENDOR", vendorCompanyId: cca.id, minMarginPercent: 40 });
    await expect(saveMarginRule(sa, { scope: "COUNTRY", minMarginPercent: 5 })).rejects.toThrow(/country/);
    await expect(saveMarginRule(sa, { scope: "GLOBAL", minMarginPercent: 10, targetMarginPercent: 5 })).rejects.toThrow(/target/);
    await expect(saveMarginRule(await ctxFor(FIN), { scope: "GLOBAL", minMarginPercent: 1 })).rejects.toThrow();
    try {
      expect(await marginFloor({ vendorId: cca.id, categoryIds: [], countryId: pt.id })).toBe(40);
      const lxId = (await prisma.company.findFirstOrThrow({ where: { legalName: "Grossista Lisboa Central, Lda" } })).id;
      expect(await marginFloor({ vendorId: lxId, categoryIds: [], countryId: pt.id })).toBe(2);
      const watch = await marginWatch(sa);
      expect(watch.some((w) => w.vendor === "Cash & Carry Almada, Lda" && w.below === "MIN")).toBe(true);
      expect((await listMarginRules(sa)).length).toBeGreaterThanOrEqual(2);
    } finally {
      for (const r of await prisma.marginRule.findMany({ where: { isActive: true } })) await removeMarginRule(sa, r.id);
    }
  });
});

describe("contracts, ratings, scorecards, KPIs", () => {
  it("contract prices with their discount against the base price", async () => {
    const rows = await contractPricing(await ctxFor(SA), { vendorType: "WHOLESALER" });
    const kebabContract = rows.find((r) => r.target.startsWith("Kebab House"));
    expect(kebabContract).toBeTruthy();
    expect(kebabContract!.items).toBeGreaterThan(0);
    expect(kebabContract!.avgDiscount).toBeGreaterThan(0);
    await expect(contractPricing(await ctxFor(KEBAB))).rejects.toThrow();
  });

  it("customer rates a delivered order; supplier answers; FIRINGI can hide it; scorecard and KPIs", async () => {
    const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX), sa = await ctxFor(SA);
    await expect(rateOrder(kebab, deliveredOrderId, { stars: 6 })).rejects.toThrow(/1 to 5/);
    const r = await rateOrder(kebab, deliveredOrderId, { stars: 4, deliveryStars: 5, comment: "Good mozzarella, fast delivery" });
    await rateOrder(kebab, deliveredOrderId, { stars: 5, deliveryStars: 5, comment: "Even better" }); // changed within 30 days
    expect((await prisma.orderRating.findUniqueOrThrow({ where: { id: r.id } })).stars).toBe(5);
    const open = await prisma.order.findFirst({ where: { buyerCompanyId: kebab.company.id, status: { not: "DELIVERED" } } });
    if (open) await expect(rateOrder(kebab, open.id, { stars: 3 })).rejects.toThrow(/delivered/);
    await replyRating(lx, r.id, "Obrigado!");
    await expect(replyRating(await ctxFor("owner@ccalmada.test"), r.id, "x")).rejects.toThrow();
    expect((await listRatings(lx)).some((x) => x.id === r.id && x.reply === "Obrigado!")).toBe(true);
    await moderateRating(sa, r.id, true);
    expect((await listRatings(lx)).some((x) => x.id === r.id)).toBe(false);
    await moderateRating(sa, r.id, false);

    const p = { from: new Date(Date.now() - 30 * 86400_000), to: new Date(Date.now() + 60_000) };
    const cards = await supplierScorecards(sa, "WHOLESALER", p);
    const lxCard = cards.find((c) => c.name === "Lisboa Central")!;
    expect(lxCard.orders).toBeGreaterThan(0);
    expect(lxCard.fillRate).toBeGreaterThan(0);
    expect(lxCard.rating).toBeGreaterThanOrEqual(4);
    expect(lxCard.score).toBeGreaterThan(0);
    expect((await supplierScorecards(lx, "ALL", p, lx.company.id))[0].id).toBe(lx.company.id); // a supplier sees its own card
    await expect(supplierScorecards(lx, "ALL", p, (await prisma.company.findFirstOrThrow({ where: { legalName: "Cash & Carry Almada, Lda" } })).id)).rejects.toThrow();

    await setKpiTarget(await ctxFor(FIN), new Date(), "revenue", 1000);
    const board = await kpiBoard(sa);
    const rev = board.rows.find((x) => x.key === "revenue")!;
    expect(rev.target).toBe(1000);
    expect(rev.current).toBeGreaterThan(0);
    expect(rev.progress).toBeCloseTo((rev.current ?? 0) / 1000, 5);
    expect(board.rows.find((x) => x.key === "rating")!.current).toBeGreaterThan(0);
  });
});
