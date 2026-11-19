/**
 * Phase 47 — the till (POS) for suppliers and wholesale customers, against the real database:
 * FIRINGI's switches (master, company type, country, company), a supplier's counter sale taking its own stock
 * FEFO (once only, also when sent offline), refunds back to stock, shifts with X/Z and cash, the Z into the
 * company's accounting, a restaurant's recipes using what it bought on FIRINGI, its guests' loyalty card,
 * cashier vs manager rights, the certified-provider stage per country (blocked / fallback / sent / outage /
 * refused), the local currency, isolation between companies, and till sales in the accountant's monthly pack.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { prisma } from "@/server/db";
import * as P from "@/server/pos/service";
import { emailReceipt, recordSale, refundSale, setSaleTaxId, type SaleInput } from "@/server/pos/sales";
import { processPosFiscalQueue } from "@/server/pos/fiscal";
import { posAccess, savePosSettings } from "@/server/pos/settings";
import { syncOp } from "@/server/app/service";
import { DEFAULT_POS_SETTINGS, type PosSettings } from "@/lib/pos";
import { addTillEmployee, removeFromTill, tillRevenue, tillStaff } from "@/server/pos/staff";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", ATL = "owner@atlantico.test", KH = "owner@kebabhouse.test", HK = "owner@hurtownia.test";
let saved: unknown = null;
let cashierEmail = "";
const created: { users: string[]; companies: string[] } = { users: [], companies: [] };
let atlRegister = "", atlShift = "", atlAddress = "", atlOffer = "", atlItem = "";
let khRegister = "", khShift = "", kebab = "", khOffer = "";
let n = 0;
const cid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const settings = async (patch: Partial<PosSettings> = {}) => savePosSettings(await ctxFor(SA), { ...DEFAULT_POS_SETTINGS, tillsWithoutApproval: 10, ...patch });
const country = (cc: string, p: Partial<PosSettings["countries"][string]>) => ({ ...DEFAULT_POS_SETTINGS.countries, [cc]: { ...DEFAULT_POS_SETTINGS.countries[cc], ...p } });
const sale = (registerId: string, shiftId: string, lines: SaleInput["lines"], payments: SaleInput["payments"], extra: Partial<SaleInput> = {}): SaleInput => ({ clientId: cid(), registerId, shiftId, n: ++n, soldAt: new Date().toISOString(), lines, payments, ...extra });
const onHand = async (offerId: string, addressId: string) => (await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId } } }))?.onHand ?? 0;

beforeAll(async () => {
  saved = (await prisma.setting.findFirst({ where: { key: "pos.settings" } }))?.value ?? null;
  await settings();
  // a cashier at Kebab House (sells, can't manage)
  const kh = await ctxFor(KH);
  const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: "POS_CASHIER" } });
  cashierEmail = `cashier.${Date.now()}@kebabhouse.test`;
  const u = await prisma.user.create({ data: { email: cashierEmail, name: "Rita Caixa" } });
  created.users.push(u.id);
  await prisma.membership.create({ data: { userId: u.id, companyId: kh.company.id, roles: { create: { roleId: role.id } } } });
  // accounting on for Kebab House (the Z goes into its books)
  await prisma.companyFeature.upsert({ where: { companyId_key: { companyId: kh.company.id, key: "ACCOUNTING" } }, update: { enabled: true }, create: { companyId: kh.company.id, key: "ACCOUNTING", enabled: true } });
});

afterAll(async () => {
  await prisma.order.updateMany({ where: { buyerCompanyId: (await ctxFor(KH)).company.id, status: { in: ["NEW", "PENDING_CONFIRMATION", "ON_HOLD"] } }, data: { status: "CANCELLED" } }).catch(() => null);
  await prisma.purchasedLot.deleteMany({ where: { sellerBatchId: { in: ["pos-test-soon", "pos-test-late"] } } });
  const ids = [(await ctxFor(ATL)).company.id, (await ctxFor(KH)).company.id, (await ctxFor(HK)).company.id];
  await prisma.posSale.deleteMany({ where: { companyId: { in: ids }, refundOfId: { not: null } } });
  await prisma.posSale.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.posRegister.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.posItem.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.posMember.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.posPin.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.posStockAccrual.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.posCompany.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.accountingEntry.deleteMany({ where: { companyId: { in: ids }, description: { startsWith: "Till sales" } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.setting.deleteMany({ where: { key: "pos.settings" } });
  if (saved) await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: "pos.settings", value: saved as never } });
  await prisma.$disconnect();
});

describe("FIRINGI decides who has a till", () => {
  it("per company type, per country, per company — and nothing for FIRINGI itself", async () => {
    const kh = await ctxFor(KH), atl = await ctxFor(ATL), sa = await ctxFor(SA);
    expect((await posAccess(kh.company.id)).on).toBe(true);
    await settings({ types: { DISTRIBUTOR: true, WHOLESALER: true, CUSTOMER: false } });
    expect(await posAccess(kh.company.id)).toMatchObject({ on: false, reason: "type" });
    await expect(P.tillSnapshot(kh)).rejects.toThrow(/switched the till on/);
    await P.setPosCompanyState(sa, kh.company.id, "ON");
    expect((await posAccess(kh.company.id)).on).toBe(true);
    await P.setPosCompanyState(sa, kh.company.id, "DEFAULT");
    await settings({ countries: country("PT", { enabled: false }) });
    expect((await posAccess(atl.company.id)).reason).toBe("country");
    await settings();
    await P.setPosCompanyState(sa, atl.company.id, "OFF");
    expect((await posAccess(atl.company.id)).reason).toBe("company");
    await P.setPosCompanyState(sa, atl.company.id, "DEFAULT");
    await expect(P.tillSnapshot(sa)).rejects.toThrow();
    await expect(P.setPosCompanyState(kh, atl.company.id, "OFF")).rejects.toThrow();
    const ov = await P.adminPosOverview(sa);
    expect(ov.byType.CUSTOMER.allowed).toBeGreaterThan(0);
    expect((await P.adminPosCompanies(sa, { type: "DISTRIBUTOR" })).every((c) => c.type === "DISTRIBUTOR")).toBe(true);
  });
});

describe("a supplier's counter (cash & carry)", () => {
  it("fills the till from its own products with retail prices incl. VAT", async () => {
    const atl = await ctxFor(ATL);
    const r = await P.importFromCatalogue(atl, "pt");
    expect(r.added).toBeGreaterThan(0);
    const { items } = await P.listItems(atl);
    const withStock = await prisma.stockLevel.findFirstOrThrow({ where: { offerId: { in: items.map((i) => i.offerId!).filter(Boolean) }, onHand: { gt: 10 } }, orderBy: { onHand: "desc" } });
    atlOffer = withStock.offerId; atlAddress = withStock.addressId;
    const it = items.find((i) => i.offerId === atlOffer)!;
    atlItem = it.id;
    expect(Number(it.price)).toBeGreaterThan(0);
    expect([6, 13, 23]).toContain(Number(it.vatRate));
    expect((await P.importFromCatalogue(atl, "pt")).added).toBe(0); // once only
    const reg = await P.saveRegister(atl, { name: "Balcão", code: "B1", addressId: atlAddress });
    atlRegister = reg.id;
    await expect(P.saveRegister(atl, { name: "Outro", code: "b1" })).rejects.toThrow(/code/);
    atlShift = (await P.openShift(atl, atlRegister, 100)).id;
    expect((await P.openShift(atl, atlRegister, 50)).id).toBe(atlShift); // one open shift per till
  });

  it("a sale takes its stock FEFO, gives change, joins the hash chain — once, even when sent twice", async () => {
    const atl = await ctxFor(ATL);
    const before = await onHand(atlOffer, atlAddress);
    const item = (await P.listItems(atl)).items.find((i) => i.id === atlItem)!;
    const gross = Math.round(Number(item.price) * 2 * 100) / 100;
    const input = sale(atlRegister, atlShift, [{ itemId: atlItem, qty: 2, unitPrice: 0.01 }], [{ method: "CASH", amount: gross, tendered: Math.ceil(gross) + 10 }]);
    const s = await recordSale(atl, input);
    expect(Number(s.gross)).toBe(gross); // today's price, not what the screen sent
    expect(s.number).toMatch(/^B1-0001-\d{4}$/);
    expect(Number(s.payments[0].change)).toBeCloseTo(Math.ceil(gross) + 10 - gross, 2);
    expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.fiscalStatus).toBe("NOT_REQUIRED");
    expect(await onHand(atlOffer, atlAddress)).toBe(before - 2);
    expect((s.lines[0].lots as { picks: unknown[] }).picks.length).toBeGreaterThan(0);
    const again = await recordSale(atl, input);
    expect(again.id).toBe(s.id);
    expect(await onHand(atlOffer, atlAddress)).toBe(before - 2);
    const s2 = await recordSale(atl, sale(atlRegister, atlShift, [{ itemId: atlItem, qty: 1, unitPrice: 0 }], [{ method: "CARD", amount: Number(item.price), ref: "1234" }]));
    expect(s2.prevHash).toBe(s.hash);
  });

  it("a sale made offline arrives through the phone app's sync (stored once)", async () => {
    const atl = await ctxFor(ATL);
    const item = (await P.listItems(atl)).items.find((i) => i.id === atlItem)!;
    const data = sale(atlRegister, atlShift, [{ itemId: atlItem, qty: 1, unitPrice: Number(item.price) }], [{ method: "CASH", amount: Number(item.price), tendered: Number(item.price) }], { soldAt: new Date(Date.now() - 3600_000).toISOString() });
    const op = { clientId: cid(), kind: "pos.sale", portal: "vendor", at: data.soldAt, data: data as unknown as Record<string, unknown> };
    const r = await syncOp(atl, op);
    expect(r.status).toBe("DONE");
    const again = await syncOp(atl, op);
    expect((again.result as { saleId: string }).saleId).toBe((r.result as { saleId: string }).saleId);
    expect((await prisma.posSale.findUniqueOrThrow({ where: { id: (r.result as { saleId: string }).saleId } })).offline).toBe(true);
  });

  it("a refund puts goods back in stock; never more than was sold", async () => {
    const atl = await ctxFor(ATL);
    const orig = await prisma.posSale.findFirstOrThrow({ where: { registerId: atlRegister, kind: "SALE" }, orderBy: { createdAt: "asc" }, include: { lines: true } });
    const before = await onHand(atlOffer, atlAddress);
    const r = await refundSale(atl, { clientId: cid(), saleId: orig.id, registerId: atlRegister, shiftId: atlShift, n: ++n, lines: [{ lineId: orig.lines[0].id, qty: 1 }], method: "CASH", reason: "Garrafa partida", restock: true });
    expect(r.kind).toBe("REFUND");
    expect(Number(r.gross)).toBeCloseTo(Number(orig.gross) / 2, 2);
    expect(await onHand(atlOffer, atlAddress)).toBe(before + 1);
    await expect(refundSale(atl, { clientId: cid(), saleId: orig.id, registerId: atlRegister, shiftId: atlShift, n: ++n, lines: [{ lineId: orig.lines[0].id, qty: 2 }], method: "CASH", reason: "x" })).rejects.toThrow(/Only 1/);
  });

  it("shift close: Z report, counted cash and the difference", async () => {
    const atl = await ctxFor(ATL);
    await P.cashMove(atl, { shiftId: atlShift, kind: "PAY_OUT", amount: 5, reason: "Gelo" });
    const { report } = await P.shiftReport(atl, atlShift);
    expect(report.count).toBe(3);
    expect(report.refundCount).toBe(1);
    expect(report.payOut).toBe(5);
    const r = await P.closeShift(atl, { shiftId: atlShift, countedCash: report.expectedCash - 0.5 });
    expect(Number(r.shift.difference)).toBe(-0.5);
    expect(r.shift.status).toBe("CLOSED");
    await expect(recordSale(atl, sale(atlRegister, atlShift, [{ itemId: atlItem, qty: 1, unitPrice: 1 }], [{ method: "CARD", amount: 1 }]))).rejects.toThrow(/closed/);
  });
});

describe("a restaurant: menu, recipes from what it bought on FIRINGI, guests, cashiers", () => {
  it("recipes use only purchased goods; selling dishes marks whole packs used, oldest expiry first", async () => {
    const kh = await ctxFor(KH);
    // Kebab House orders something on FIRINGI (the test database has no order history)
    const { addToCart, clearCart } = await import("@/server/services/cart");
    const { placeOrder } = await import("@/server/services/orders");
    await clearCart(kh);
    const lisboa = await prisma.company.findFirstOrThrow({ where: { legalName: "Grossista Lisboa Central, Lda" } });
    const stocked = await prisma.stockLevel.findMany({ where: { onHand: { gt: 40 }, offer: { vendorCompanyId: lisboa.id, status: "ACTIVE", prices: { some: {} } } }, select: { offerId: true }, take: 6 });
    for (const o of stocked) await addToCart(kh, o.offerId, 6).catch(() => null);
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kh.company.id, kind: "DELIVERY", isActive: true } });
    const placed = await placeOrder(kh, { deliveryAddressId: addr.id });
    const orderId = "orders" in placed ? placed.orders[0].id : (placed as { id: string }).id;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const line = order.lines[0];
    khOffer = line.offerId;
    const offer = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: khOffer } });
    const soon = new Date(Date.now() + 5 * 86_400_000), later = new Date(Date.now() + 40 * 86_400_000);
    await prisma.purchasedLot.createMany({ data: [
      { buyerCompanyId: kh.company.id, orderId: order.id, offerId: khOffer, packagingUnitId: offer.packagingUnitId, sellerBatchId: "pos-test-late", lotCode: "LATE", expiresOn: later, qty: 3 },
      { buyerCompanyId: kh.company.id, orderId: order.id, offerId: khOffer, packagingUnitId: offer.packagingUnitId, sellerBatchId: "pos-test-soon", lotCode: "SOON", expiresOn: soon, qty: 2 },
    ] });
    const item = await P.saveItem(kh, { name: "Kebab no pão", category: "Pratos", price: 7.5, vatRate: 13, kitchen: true });
    kebab = item.id;
    await expect(P.saveRecipe(kh, kebab, [{ offerId: atlOffer, qty: 1, unit: "PACK" }])).rejects.toThrow(/bought on FIRINGI/);
    await P.saveRecipe(kh, kebab, [{ offerId: khOffer, qty: 0.25, unit: "PACK" }]);
    await expect(P.saveItem(kh, { name: "Cerveja", price: 2, vatRate: 23, offerId: khOffer })).rejects.toThrow(/recipe/);
    const reg = await P.saveRegister(kh, { name: "Caixa", code: "K1" });
    khRegister = reg.id;
    khShift = (await P.openShift(kh, khRegister, 50)).id;
    const s = await recordSale(kh, sale(khRegister, khShift, [{ itemId: kebab, qty: 5, unitPrice: 7.5 }], [{ method: "CARD", amount: 37.5 }]));
    expect(s.gross.toFixed(2)).toBe("37.50");
    const lots = await prisma.purchasedLot.findMany({ where: { buyerCompanyId: kh.company.id, sellerBatchId: { in: ["pos-test-soon", "pos-test-late"] } } });
    expect(lots.find((l) => l.lotCode === "SOON")!.usedQty).toBe(1);
    expect(lots.find((l) => l.lotCode === "LATE")!.usedQty).toBe(0);
    const acc = await prisma.posStockAccrual.findUniqueOrThrow({ where: { companyId_offerId_addressId: { companyId: kh.company.id, offerId: khOffer, addressId: "" } } });
    expect(Number(acc.pending)).toBeCloseTo(0.25, 6);
    const stock = await P.ingredientStock(kh, "pt");
    const row = stock.find((x) => x.offerId === khOffer)!;
    expect(row.left).toBe(4);
    expect(row.dishes).toContain("Kebab no pão");
    expect(row.usedPerDay).toBeGreaterThan(0);
  });

  it("age check for alcohol; the guests' loyalty card earns and pays with points", async () => {
    const kh = await ctxFor(KH);
    const beer = await P.saveItem(kh, { name: "Imperial", price: 2, vatRate: 23, restriction: "ALCOHOL" });
    await expect(recordSale(kh, sale(khRegister, khShift, [{ itemId: beer.id, qty: 1, unitPrice: 2 }], [{ method: "CASH", amount: 2 }]))).rejects.toThrow(/age/);
    await P.savePosCompany(kh, { loyaltyOn: true, pointsPerUnit: 10, pointValue: 0.01, minRedeem: 100 });
    await expect(P.saveMember(kh, { name: "Ana", phone: "912345678", consent: false })).rejects.toThrow(/agree/);
    const m = await P.saveMember(kh, { name: "Ana", phone: "912 345 678", consent: true });
    expect(m.code).toBe("912345678");
    const s1 = await recordSale(kh, sale(khRegister, khShift, [{ itemId: kebab, qty: 2, unitPrice: 7.5 }], [{ method: "CASH", amount: 15, tendered: 20 }], { memberId: m.id }));
    expect(s1.pointsEarned).toBe(150);
    // pay 1.50 with 150 points, the rest in cash; points paid earn none
    const s2 = await recordSale(kh, sale(khRegister, khShift, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "POINTS", amount: 1.5 }, { method: "CASH", amount: 6, tendered: 6 }], { memberId: m.id, pointsUsed: 150 }));
    expect(s2.pointsUsed).toBe(150);
    expect(s2.pointsEarned).toBe(60);
    expect((await prisma.posMember.findUniqueOrThrow({ where: { id: m.id } })).points).toBe(60);
    await expect(recordSale(kh, sale(khRegister, khShift, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "POINTS", amount: 1 }, { method: "CASH", amount: 6.5 }], { memberId: m.id, pointsUsed: 100 }))).rejects.toThrow(/points/i);
  });

  it("a cashier needs a manager's PIN for big discounts, refunds and taking cash out", async () => {
    const kh = await ctxFor(KH), c = await ctxFor(cashierEmail);
    await P.setPin(kh, kh.user.id, "4321");
    await P.setPin(c, c.user.id, "1111");
    await expect(P.setPin(c, kh.user.id, "9999")).rejects.toThrow();
    await expect(P.setPin(kh, c.user.id, "4321")).rejects.toThrow(/another PIN/);
    const mgr = await P.verifyPin(c, "4321", true);
    expect(mgr.userId).toBe(kh.user.id);
    await expect(P.verifyPin(c, "1111", true)).rejects.toThrow(/manager/);
    await expect(P.verifyPin(c, "0000")).rejects.toThrow(/Wrong/);
    const big = sale(khRegister, khShift, [{ itemId: kebab, qty: 2, unitPrice: 7.5, discountPct: 30 }], [{ method: "CASH", amount: 10.5 }]);
    await expect(recordSale(c, big)).rejects.toThrow(/manager/);
    const ok = await recordSale(c, { ...big, approvedById: mgr.userId });
    expect(ok.approvedById).toBe(kh.user.id);
    expect(ok.gross.toFixed(2)).toBe("10.50");
    await expect(refundSale(c, { clientId: cid(), saleId: ok.id, registerId: khRegister, shiftId: khShift, n: ++n, lines: [{ lineId: ok.lines[0].id, qty: 1 }], method: "CASH", reason: "Frio" })).rejects.toThrow(/manager/);
    await expect(P.cashMove(c, { shiftId: khShift, kind: "PAY_OUT", amount: 10, reason: "Pão" })).rejects.toThrow(/manager/);
    await P.cashMove(c, { shiftId: khShift, kind: "PAY_OUT", amount: 10, reason: "Pão", approvedById: mgr.userId });
    await expect(P.saveItem(c, { name: "x", price: 1, vatRate: 23 })).rejects.toThrow();
    // a cashier sees only their own sales
    expect((await P.listSales(c)).every((s) => s.cashierId === c.user.id)).toBe(true);
  });

  it("each day's till sales go into the company's Accounting as cash and card — rebuilt nightly, never twice", async () => {
    const kh = await ctxFor(KH);
    const { report } = await P.shiftReport(kh, khShift);
    const r = await P.closeShift(kh, { shiftId: khShift, countedCash: report.expectedCash });
    expect(Number(r.shift.difference)).toBe(0);
    expect(r.posted).toBeGreaterThan(0);
    const day = new Date().toISOString().slice(0, 10);
    const entries = async () => prisma.accountingEntry.findMany({ where: { companyId: kh.company.id, description: { startsWith: "Till sales" }, date: new Date(`${day}T00:00:00.000Z`) } });
    const e1 = await entries();
    const total = e1.reduce((a, e) => a + Number(e.amount), 0);
    expect(total).toBeCloseTo(report.gross - (report.byPayment.POINTS ?? 0), 1);
    expect(e1.some((e) => e.category === "SALES_CARD" && /card$/.test(e.description ?? ""))).toBe(true);
    expect(e1.some((e) => e.category === "SALES_CASH" && /cash$/.test(e.description ?? ""))).toBe(true);
    // the nightly run rebuilds the day: same entries, same total
    await P.runDailyTillPosting();
    const e2 = await entries();
    expect(e2.length).toBe(e1.length);
    expect(e2.reduce((a, e) => a + Number(e.amount), 0)).toBeCloseTo(total, 2);
    // a sale sent late by an offline till joins its own day
    const sh = await P.openShift(kh, khRegister, 0);
    khShift = sh.id;
    const yesterday = new Date(Date.now() - 86_400_000);
    await recordSale(kh, sale(khRegister, sh.id, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "CASH", amount: 7.5, tendered: 7.5 }], { soldAt: yesterday.toISOString() }), { offline: true });
    await P.runDailyTillPosting();
    const y = await prisma.accountingEntry.findMany({ where: { companyId: kh.company.id, description: { startsWith: "Till sales" }, date: new Date(`${yesterday.toISOString().slice(0, 10)}T00:00:00.000Z`) } });
    expect(y.reduce((a, e) => a + Number(e.amount), 0)).toBeCloseTo(7.5, 2);
    expect(y[0].category).toBe("SALES_CASH");
  });

  it("the accountant's monthly pack carries the till receipts as XML and the day totals as a third side", async () => {
    const kh = await ctxFor(KH);
    const { buildMonthlyPack } = await import("@/server/einvoice/monthly");
    const period = new Date().toISOString().slice(0, 7);
    const p = await buildMonthlyPack(kh.company.id, period);
    const till = p.rows.filter((r) => r.side === "TILL");
    expect(till.length).toBeGreaterThan(0);
    expect(till.every((r) => r.kind === "TILL_DAY")).toBe(true);
    const files = unzipSync(new Uint8Array(p.zip));
    const xml = strFromU8(files[`xml/till/till-sales-${period}.xml`]);
    expect(xml).toContain("<TillSales");
    expect(xml).toMatch(/<Receipt number="K1-\d{4}-\d{4}"/);
    expect(xml).toContain('method="POINTS"');
  });
});

describe("certified receipts per country", () => {
  it("a country on a provider: blocked until the business connects (unless FIRINGI allows non-fiscal meanwhile)", async () => {
    const kh = await ctxFor(KH);
    await settings({ countries: country("PT", { stage: "PROVIDER", provider: "moloni", fallbackNonFiscal: false }) });
    const shift = (await P.openShift(kh, khRegister, 0)).id;
    khShift = shift;
    expect((await posAccess(kh.company.id)).blocked).toBe(true);
    await expect(recordSale(kh, sale(khRegister, shift, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "CARD", amount: 7.5 }]))).rejects.toThrow(/certified provider/);
    await settings({ countries: country("PT", { stage: "PROVIDER", provider: "moloni", fallbackNonFiscal: true }) });
    const s = await recordSale(kh, sale(khRegister, shift, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "CARD", amount: 7.5 }]));
    expect(s.fiscalStatus).toBe("NOT_REQUIRED");
    await expect(P.saveFiscalConnection(kh, { provider: "fiscal-device", account: "x", secret: "secret-123" })).resolves.toBeTruthy(); // offered everywhere
    await expect(P.saveFiscalConnection(kh, { provider: "moloni", account: "", secret: "secret-123" })).rejects.toThrow(/account/);
  });

  it("connected: the legal number comes back with the sale; an outage waits and is sent later; a refusal fails and alerts", async () => {
    const kh = await ctxFor(KH);
    const c = await P.saveFiscalConnection(kh, { provider: "moloni", account: "kebabhouse", secret: "moloni-key-123456" });
    expect(c).toMatchObject({ connected: true, test: { ok: true } });
    const row = await prisma.posCompany.findUniqueOrThrow({ where: { companyId: kh.company.id } });
    expect(row.fiscalSecretEnc).not.toContain("moloni-key");
    expect(row.fiscalSecretHint).toBe("••••3456");
    const s = await recordSale(kh, sale(khRegister, khShift, [{ itemId: kebab, qty: 2, unitPrice: 7.5 }], [{ method: "CARD", amount: 15 }], { customerTaxId: "123456789" }));
    expect(s.fiscalStatus).toBe("DONE");
    expect(s.fiscalNumber).toMatch(/^FS POS\d{4}\/\d+$/);
    expect(s.fiscalQr).toContain("A:");
    await prisma.posCompany.update({ where: { companyId: kh.company.id }, data: { fiscalAccount: "down" } });
    const late = await recordSale(kh, sale(khRegister, khShift, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "CASH", amount: 7.5 }]));
    expect(late.fiscalStatus).toBe("PENDING");
    expect(late.fiscalNextAt).not.toBeNull();
    await prisma.posCompany.update({ where: { companyId: kh.company.id }, data: { fiscalAccount: "kebabhouse" } });
    await processPosFiscalQueue(50, new Date(Date.now() + 3600_000));
    expect((await prisma.posSale.findUniqueOrThrow({ where: { id: late.id } })).fiscalStatus).toBe("DONE");
    await prisma.posCompany.update({ where: { companyId: kh.company.id }, data: { fiscalAccount: "reject" } });
    const bad = await recordSale(kh, sale(khRegister, khShift, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "CASH", amount: 7.5 }]));
    expect(bad.fiscalStatus).toBe("FAILED");
    expect(bad.fiscalError).toMatch(/refused/);
    const sa = await ctxFor(SA);
    expect((await P.adminFiscalQueue(sa)).some((x) => x.id === bad.id)).toBe(true);
    await prisma.posCompany.update({ where: { companyId: kh.company.id }, data: { fiscalAccount: "kebabhouse" } });
    const { retryFiscal } = await import("@/server/pos/fiscal");
    expect(await retryFiscal(kh, bad.id)).toBe("DONE");
    await settings();
  });
});

describe("other countries, isolation, the public receipt", () => {
  it("a Polish wholesaler's till sells in złoty", async () => {
    const hk = await ctxFor(HK);
    const snap = await P.tillSnapshot(hk);
    expect(snap.settings.currency).toBe("PLN");
    const item = await P.saveItem(hk, { name: "Woda 1,5 l", price: 2.99, vatRate: 8 });
    const reg = await P.saveRegister(hk, { name: "Kasa", code: "P1" });
    const sh = await P.openShift(hk, reg.id, 200);
    const s = await recordSale(hk, sale(reg.id, sh.id, [{ itemId: item.id, qty: 3, unitPrice: 2.99 }], [{ method: "CASH", amount: 8.97, tendered: 10 }]));
    expect(s.currency).toBe("PLN");
    expect(s.payments[0].change?.toFixed(2)).toBe("1.03");
  });

  it("one company never touches another's till; the receipt page opens by its token only", async () => {
    const hk = await ctxFor(HK), kh = await ctxFor(KH);
    await expect(P.openShift(hk, khRegister, 0)).rejects.toThrow(/not found/);
    const khSale = await prisma.posSale.findFirstOrThrow({ where: { registerId: khRegister } });
    await expect(P.saleDetail(hk, khSale.id)).rejects.toThrow();
    await expect(recordSale(hk, sale(khRegister, khShift, [{ itemId: kebab, qty: 1, unitPrice: 7.5 }], [{ method: "CASH", amount: 7.5 }]))).rejects.toThrow();
    await expect(P.adminPosOverview(kh)).rejects.toThrow();
    const { publicReceipt } = await import("@/server/pos/sales");
    const r = await publicReceipt(khSale.receiptToken);
    expect(r?.sale.id).toBe(khSale.id);
    expect(await publicReceipt("nope")).toBeNull();
  });
});

describe("each shop / warehouse its own tills and people; extra tills approved by FIRINGI", () => {
  it("a grocery and a restaurant: each till its own items, its own people, its own books and reports", async () => {
    const kh = await ctxFor(KH), sa = await ctxFor(SA);
    const grocery = await prisma.branch.create({ data: { companyId: kh.company.id, name: "Mercearia Alfama", code: "MA" } });
    const resto = await prisma.branch.create({ data: { companyId: kh.company.id, name: "Restaurante Baixa", code: "RB" } });
    // extra tills wait for FIRINGI
    await settings({ tillsWithoutApproval: 0 });
    const g = await P.saveRegister(kh, { name: "Caixa mercearia", code: "G1", branchId: grocery.id });
    expect(g.approval).toBe("PENDING");
    expect((await P.tillSnapshot(kh, g.id)).register?.id).not.toBe(g.id); // can't be used yet
    expect((await P.adminTillRequests(sa)).some((r) => r.id === g.id)).toBe(true);
    await expect(P.decideTill(kh, g.id, true)).rejects.toThrow();
    await expect(P.decideTill(sa, g.id, false)).rejects.toThrow(/reason/);
    await P.decideTill(sa, g.id, true);
    const r = await P.saveRegister(kh, { name: "Caixa restaurante", code: "R1", branchId: resto.id });
    await P.decideTill(sa, r.id, true);
    const refused = await P.saveRegister(kh, { name: "Terceira", code: "X9" });
    await P.decideTill(sa, refused.id, false, "One till per shop");
    expect((await prisma.posRegister.findUniqueOrThrow({ where: { id: refused.id } })).active).toBe(false);
    await settings();
    // items per till
    const bread = await P.saveItem(kh, { name: "Pão alentejano", price: 2.2, vatRate: 6, registerIds: [g.id] });
    const steak = await P.saveItem(kh, { name: "Bitoque", price: 9.5, vatRate: 13, registerIds: [r.id] });
    expect((await P.tillSnapshot(kh, g.id)).items.some((i) => i.id === bread.id)).toBe(true);
    expect((await P.tillSnapshot(kh, g.id)).items.some((i) => i.id === steak.id)).toBe(false);
    // people per till: Rita only at the grocery, as cashier
    const rita = await ctxFor(cashierEmail);
    await P.setRegisterUsers(kh, g.id, [{ userId: rita.user.id, role: "SELL" }]);
    expect((await P.tillSnapshot(rita)).registers.map((x) => x.id)).toContain(g.id);
    await expect(P.openShift(rita, r.id, 0)).rejects.toThrow(/use this till/);
    const gs = await P.openShift(rita, g.id, 20);
    await expect(recordSale(rita, sale(g.id, gs.id, [{ itemId: steak.id, qty: 1, unitPrice: 9.5 }], [{ method: "CARD", amount: 9.5 }]))).rejects.toThrow(/isn't sold at this till/);
    await recordSale(rita, sale(g.id, gs.id, [{ itemId: bread.id, qty: 3, unitPrice: 2.2 }], [{ method: "CASH", amount: 6.6, tendered: 10 }]));
    const rs = await P.openShift(kh, r.id, 50);
    await recordSale(kh, sale(r.id, rs.id, [{ itemId: steak.id, qty: 2, unitPrice: 9.5 }], [{ method: "CARD", amount: 19 }]));
    // Rita sees her grocery sales only, no reports (not a manager)
    expect((await P.listSales(rita)).every((x) => x.registerId === g.id)).toBe(true);
    await expect(P.salesReport(rita, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) })).rejects.toThrow(/managers/);
    // Rita becomes the grocery's shop manager: its reports, not the restaurant's
    await P.setRegisterUsers(kh, g.id, [{ userId: rita.user.id, role: "MANAGE" }]);
    const rep = await P.salesReport(rita, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(rep.byTill.map((x) => x.id)).toEqual([g.id]);
    expect(rep.totals.gross).toBeCloseTo(6.6, 2);
    // the owner sees both, per till and shop
    const all = await P.salesReport(kh, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(all.byTill.find((x) => x.id === g.id)).toMatchObject({ shop: "Mercearia Alfama", cash: 6.6 });
    expect(all.byTill.find((x) => x.id === r.id)).toMatchObject({ shop: "Restaurante Baixa", card: 19 });
    // the day's accounting per shop and till
    const day = new Date().toISOString().slice(0, 10);
    await P.postDailyTillSales(kh.company.id, day);
    const e = await prisma.accountingEntry.findMany({ where: { companyId: kh.company.id, description: { startsWith: `Till sales ${day}` } } });
    expect(e.some((x) => x.branchId === grocery.id && x.category === "SALES_CASH" && /G1 — cash$/.test(x.description ?? ""))).toBe(true);
    expect(e.some((x) => x.branchId === resto.id && x.category === "SALES_CARD" && /R1 — card$/.test(x.description ?? ""))).toBe(true);
    // a manager PIN only approves on the till it manages
    await P.setPin(kh, rita.user.id, "2468");
    const snapR = await P.tillSnapshot(kh, r.id);
    expect(snapR.pins.find((p) => p.userId === rita.user.id)?.manager).toBe(false);
    const snapG = await P.tillSnapshot(kh, g.id);
    expect(snapG.pins.find((p) => p.userId === rita.user.id)?.manager).toBe(true);
    await prisma.accountingEntry.deleteMany({ where: { companyId: kh.company.id, description: { startsWith: "Till sales" } } });
    await prisma.posSale.deleteMany({ where: { registerId: { in: [g.id, r.id] } } });
    await prisma.posRegister.deleteMany({ where: { id: { in: [g.id, r.id, refused.id] } } });
    await prisma.branch.deleteMany({ where: { id: { in: [grocery.id, resto.id] } } });
  });
});

describe("the owner and shop managers add their till staff and see the revenue", () => {
  it("owner adds a shop manager; the manager adds cashiers for their own till only; revenue today … all time, per till", async () => {
    const kh = await ctxFor(KH), sa = await ctxFor(SA);
    const stamp = Date.now().toString(36);
    const shop = await prisma.branch.create({ data: { companyId: kh.company.id, name: "Mercearia Graça", code: "MG" } });
    const g = await P.saveRegister(kh, { name: "Caixa Graça", code: "G2", branchId: shop.id });
    const r = await P.saveRegister(kh, { name: "Caixa Bar", code: "B2" });
    for (const t of [g, r]) if (t.approval === "PENDING") await P.decideTill(sa, t.id, true);
    // the owner adds a shop manager for the grocery till — a login with the cashier role, manager of that till only
    const mgrEmail = `manager.${stamp}@kebabhouse.test`;
    const { userId: mgrId } = await addTillEmployee(kh, { name: "Marta Gerente", email: mgrEmail, password: "ManagerPass1", registerIds: [g.id], role: "MANAGE" });
    created.users.push(mgrId);
    const acc = await prisma.account.findFirstOrThrow({ where: { userId: mgrId, providerId: "credential" } });
    expect(acc.password).toBeTruthy();
    expect(acc.password).not.toContain("ManagerPass1");
    const mgr = await ctxFor(mgrEmail);
    expect(mgr.permissions).toContain("company.pos.sell");
    expect(mgr.permissions).not.toContain("company.pos.manage");
    // the manager adds a cashier for their own till; not for another till, and no managers
    const cashier = `kasa.${stamp}@kebabhouse.test`;
    await expect(addTillEmployee(mgr, { name: "Rui", email: cashier, password: "CashierPass1", registerIds: [r.id], role: "SELL" })).rejects.toThrow(/tills you manage/);
    await expect(addTillEmployee(mgr, { name: "Rui", email: cashier, password: "CashierPass1", registerIds: [g.id], role: "MANAGE" })).rejects.toThrow(/Only the owner/);
    await expect(addTillEmployee(mgr, { name: "Rui", email: cashier, password: "short", registerIds: [g.id], role: "SELL" })).rejects.toThrow(/10 characters/);
    await expect(addTillEmployee(mgr, { name: "Rui", email: ATL, password: "CashierPass1", registerIds: [g.id], role: "SELL" })).rejects.toThrow(/already exists/);
    const { userId: cashId } = await addTillEmployee(mgr, { name: "Rui Caixa", email: cashier, password: "CashierPass1", registerIds: [g.id], role: "SELL" });
    created.users.push(cashId);
    const rui = await ctxFor(cashier);
    expect((await P.tillSnapshot(rui)).registers.map((x) => x.id)).toEqual([g.id]);
    // the manager's staff page: their till, the two people; a cashier has no staff page and no revenue
    const st = await tillStaff(mgr);
    expect(st.owner).toBe(false);
    expect(st.tills.map((x) => x.id)).toEqual([g.id]);
    expect(st.people.map((p) => p.email).sort()).toEqual([cashier, mgrEmail].sort());
    await expect(tillStaff(rui)).rejects.toThrow(/managers/);
    expect(await tillRevenue(rui)).toBeNull();
    // sales at both tills, and a refund at the grocery
    const bread = await P.saveItem(kh, { name: "Broa", price: 3, vatRate: 6, registerIds: [g.id, r.id] });
    const gs = await P.openShift(rui, g.id, 20);
    const s1 = await recordSale(rui, sale(g.id, gs.id, [{ itemId: bread.id, qty: 4, unitPrice: 3 }], [{ method: "CASH", amount: 12, tendered: 20 }]));
    await recordSale(mgr, sale(g.id, gs.id, [{ itemId: bread.id, qty: 1, unitPrice: 3 }], [{ method: "CARD", amount: 3 }]));
    const line = (await prisma.posSaleLine.findFirstOrThrow({ where: { saleId: s1.id } })).id;
    await refundSale(mgr, { clientId: cid(), saleId: s1.id, registerId: g.id, shiftId: gs.id, n: ++n, lines: [{ lineId: line, qty: 1 }], method: "CASH", reason: "Partida", restock: false });
    // a sale last year at the grocery: in "all time", not in "this year"
    const old = await recordSale(rui, sale(g.id, gs.id, [{ itemId: bread.id, qty: 2, unitPrice: 3 }], [{ method: "CASH", amount: 6 }]));
    await prisma.posSale.update({ where: { id: old.id }, data: { soldAt: new Date(new Date().getFullYear() - 1, 5, 1) } });
    const bs = await P.openShift(kh, r.id, 0);
    await recordSale(kh, sale(r.id, bs.id, [{ itemId: bread.id, qty: 10, unitPrice: 3 }], [{ method: "CARD", amount: 30 }]));
    // the shop manager: the grocery till only — sales minus the refund
    const mr = (await tillRevenue(mgr))!;
    expect(mr.tills.map((x) => x.id)).toEqual([g.id]);
    expect(mr.total.today).toBeCloseTo(12, 2);
    expect(mr.total.week).toBeCloseTo(12, 2);
    expect(mr.total.year).toBeCloseTo(12, 2);
    expect(mr.total.all).toBeCloseTo(18, 2);
    expect(mr.since!.getFullYear()).toBe(new Date().getFullYear() - 1);
    // the owner: every till, per till and in total
    const or = (await tillRevenue(kh))!;
    expect(or.tills.find((x) => x.id === g.id)).toMatchObject({ shop: "Mercearia Graça", today: 12, all: 18 });
    expect(or.tills.find((x) => x.id === r.id)).toMatchObject({ today: 30, all: 30 });
    expect(or.total.all).toBeGreaterThanOrEqual(48);
    expect(or.total.today).toBeGreaterThanOrEqual(42);
    // removing: the manager takes the cashier off; only the owner changes shop managers
    await expect(removeFromTill(mgr, g.id, mgrId)).rejects.toThrow(/Only the owner/);
    await removeFromTill(mgr, g.id, cashId);
    expect((await tillStaff(mgr)).people.map((p) => p.email)).toEqual([mgrEmail]);
    await expect(removeFromTill(mgr, r.id, cashId)).rejects.toThrow();
    // adding someone already in the company only puts them on the till
    await addTillEmployee(kh, { name: "x", email: cashier, password: "Whatever123", registerIds: [r.id], role: "SELL" });
    expect(await prisma.user.count({ where: { email: cashier } })).toBe(1);
    expect((await P.tillSnapshot(rui)).registers.map((x) => x.id)).toEqual([r.id]);
    await prisma.posSale.deleteMany({ where: { registerId: { in: [g.id, r.id] }, refundOfId: { not: null } } });
    await prisma.posSale.deleteMany({ where: { registerId: { in: [g.id, r.id] } } });
    await prisma.posRegister.deleteMany({ where: { id: { in: [g.id, r.id] } } });
    await prisma.posItem.deleteMany({ where: { id: bread.id } });
    await prisma.branch.deleteMany({ where: { id: shop.id } });
  });
});

describe("the customer's NIF and VAT per item on receipts", () => {
  it("a wrong NIF is refused at the till, the final-consumer number means none, an offline one is kept; added later while not certified", async () => {
    const kh = await ctxFor(KH);
    const t = await P.saveRegister(kh, { name: "Caixa NIF", code: "N1" });
    if (t.approval === "PENDING") await P.decideTill(await ctxFor(SA), t.id, true);
    const sh = await P.openShift(kh, t.id, 0);
    const beer = await P.saveItem(kh, { name: "Imperial NIF", price: 2, vatRate: 23 });
    const soup = await P.saveItem(kh, { name: "Sopa NIF", price: 3, vatRate: 13 });
    const lines = [{ itemId: beer.id, qty: 2, unitPrice: 2 }, { itemId: soup.id, qty: 1, unitPrice: 3 }];
    const pay = [{ method: "CARD" as const, amount: 7 }];
    await expect(recordSale(kh, sale(t.id, sh.id, lines, pay, { customerTaxId: "123456780" }))).rejects.toThrow(/NIF isn't valid/);
    const a = await recordSale(kh, sale(t.id, sh.id, lines, pay, { customerTaxId: "123 456 789", customerName: "Ana Lopes" }));
    expect((await prisma.posSale.findUniqueOrThrow({ where: { id: a.id } })).customerTaxId).toBe("123456789");
    const b = await recordSale(kh, sale(t.id, sh.id, lines, pay, { customerTaxId: "999999990" }));
    expect((await prisma.posSale.findUniqueOrThrow({ where: { id: b.id } })).customerTaxId).toBeNull();
    const off = await recordSale(kh, sale(t.id, sh.id, lines, pay, { customerTaxId: "12345" }), { offline: true });
    expect((await prisma.posSale.findUniqueOrThrow({ where: { id: off.id } })).customerTaxId).toBe("12345");
    // each line keeps its own VAT rate and amount; per rate they add up to the receipt
    const ls = await prisma.posSaleLine.findMany({ where: { saleId: b.id }, orderBy: { name: "asc" } });
    expect(ls.map((l) => [l.name, Number(l.vatRate), Number(l.vat)])).toEqual([["Imperial NIF", 23, 0.75], ["Sopa NIF", 13, 0.35]]);
    const sb = await prisma.posSale.findUniqueOrThrow({ where: { id: b.id } });
    expect(Number(sb.vat)).toBeCloseTo(1.1, 2);
    // the customer asks for the NIF after paying: added (non-fiscal receipt), checked, audited
    await expect(setSaleTaxId(kh, b.id, "123456780")).rejects.toThrow(/NIF isn't valid/);
    expect((await setSaleTaxId(kh, b.id, "504426290", "Restaurante X")).customerTaxId).toBe("504426290");
    expect(await prisma.auditLog.count({ where: { action: "pos.sale.tax_id", entityId: b.id } })).toBe(1);
    // a certified receipt can't change any more
    await prisma.posSale.update({ where: { id: a.id }, data: { fiscalStatus: "DONE", fiscalNumber: "FS POS/1" } });
    await expect(setSaleTaxId(kh, a.id, "504426290")).rejects.toThrow(/already certified/);
    // the e-mailed receipt shows the VAT of each item and per rate
    const { mkdtemp, readdir, readFile } = await import("node:fs/promises");
    const dir = await mkdtemp((await import("node:path")).join((await import("node:os")).tmpdir(), "pos-mail-"));
    const prev = process.env.STORAGE_DIR; process.env.STORAGE_DIR = dir;
    try {
      await emailReceipt(b.id, "ana.lopes@example.test");
      const files = (await readdir(`${dir}/mail-outbox`)).filter((f) => f.endsWith(".json"));
      const text = (JSON.parse(await readFile(`${dir}/mail-outbox/${files[0]}`, "utf8")) as { text: string }).text;
      expect(text).toMatch(/Imperial NIF {2}\(IVA 23%\)/);
      expect(text).toMatch(/IVA 23%: 3\.25 \+ 0\.75 = 4\.00/);
      expect(text).toMatch(/IVA 13%: 2\.65 \+ 0\.35 = 3\.00/);
      expect(text).toMatch(/NIF: 504426290 · Restaurante X/);
    } finally { process.env.STORAGE_DIR = prev; }
    await prisma.posSale.deleteMany({ where: { registerId: t.id } });
    await prisma.posRegister.deleteMany({ where: { id: t.id } });
    await prisma.posItem.deleteMany({ where: { id: { in: [beer.id, soup.id] } } });
  });
});
