/**
 * Phase 63: van sales — the manager loads a van (goods leave the warehouse, first to expire first), the seller sells
 * to a customer at its prices: a FIRINGI order delivered at once and invoiced, paid in cash on the spot; the same
 * sale sent twice is done once; online stock never includes the van; at the end of the day leftovers go back and the
 * cash is counted; collected cash is netted from the supplier's open invoices; FIRINGI's switches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";
import { setStock } from "@/server/services/vendor-catalogue";
import * as V from "@/server/vansales/service";
import { ctxFor } from "../helpers";

const LX = "owner@lisboacentral.test", KB = "owner@kebabhouse.test", ADMIN = "superadmin@firingi.test";
let lxId = "", kbId = "", sellerId = "", rice = "", whId = "", addressId = "", loadId = "";
const sellerCtx = async () => (await loadContext(sellerId, "t", lxId))!;
const onHand = async () => (await prisma.stockLevel.findUniqueOrThrow({ where: { offerId_addressId: { offerId: rice, addressId: whId } } })).onHand;

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KB);
  lxId = lx.company.id; kbId = kb.company.id;
  await prisma.setting.deleteMany({ where: { key: "vansales.settings" } });
  await prisma.vanLoad.updateMany({ where: { vendorCompanyId: lxId, status: { in: ["OPEN", "ON_ROAD"] } }, data: { status: "CANCELLED" } });
  const u = await prisma.user.create({ data: { email: `van.${Date.now()}@lisboacentral.test`, name: "Vasco Van" } });
  sellerId = u.id;
  const m = await prisma.membership.create({ data: { userId: u.id, companyId: lxId } });
  const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: "VENDOR_VAN" } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: "WAREHOUSE", isActive: true } });
  whId = wh.id;
  const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, vendorSku: "GRO-ARROZ1", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  rice = o.id;
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
  await setStock(lx, o.id, wh.id, Math.max(500, (cur?.reserved ?? 0) + 300));
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kbId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "vansales.settings" } });
  await prisma.$disconnect();
});

describe("van sales", () => {
  it("the manager loads a van: goods leave the warehouse and the round starts", async () => {
    const lx = await ctxFor(LX);
    const ov = await V.vanOverview(lx);
    expect(ov.sellers.some((s) => s.id === sellerId)).toBe(true);
    const load = await V.createLoad(lx, { warehouseId: whId, sellerUserId: sellerId });
    loadId = load.id;
    await expect(V.createLoad(lx, { warehouseId: whId, sellerUserId: sellerId })).rejects.toThrow(/already has a van/);
    expect((await V.loadableProducts(lx, loadId, "GRO-ARROZ1")).some((p) => p.offerId === rice)).toBe(true);
    const before = await onHand();
    await V.addToLoad(lx, loadId, rice, 40);
    expect(await onHand()).toBe(before - 40);
    const d = await V.loadDetail(lx, loadId);
    expect(d.products.find((p) => p.offerId === rice)).toMatchObject({ loaded: 40, sold: 0, left: 40 });
    await V.startRound(lx, loadId);
    expect((await prisma.vanLoad.findUniqueOrThrow({ where: { id: loadId } })).status).toBe("ON_ROAD");
  });

  it("the seller sells at the customer's prices: delivered, invoiced by FIRINGI, paid in cash — once", async () => {
    const sc = await sellerCtx();
    const van = await V.myVan(sc);
    expect(van.load?.number).toBeTruthy();
    expect((await V.vanCustomers(sc, "Kebab")).some((c) => c.id === kbId)).toBe(true);
    const prices = await V.vanPrices(sc, kbId);
    const p = prices.find((x) => x.offerId === rice)!;
    expect(p.unitNet).toBeGreaterThan(0);
    expect(p.left).toBe(40);
    const before = await onHand();
    const r = await V.sellFromVan(sc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 6 }], method: "CASH", signedBy: "Karim", clientRef: "sale-test-0001" });
    expect(r.status).toBe("DONE");
    expect(await onHand()).toBe(before); // already left the warehouse when loaded
    const order = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId! }, include: { lines: true } });
    expect(order.status).toBe("DELIVERED");
    expect(order.deliveryFeeNet.toNumber()).toBe(0);
    expect(order.lines[0].qtyDelivered).toBe(6);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id, docType: { not: "CREDIT_NOTE" } } });
    expect(inv.recipientCompanyId).toBe(kbId);
    expect(r.gross).toBeCloseTo(Number(inv.grossTotal), 2);
    expect(r.paid).toBeCloseTo(r.gross, 2);
    const ship = await prisma.stockMovement.findMany({ where: { orderId: order.id, type: "SHIPMENT" } });
    expect(ship.reduce((a, m) => a + m.qty, 0)).toBe(6);
    // sent again from the outbox: the same sale
    const again = await V.sellFromVan(sc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 6 }], method: "CASH", signedBy: "Karim", clientRef: "sale-test-0001" });
    expect(again.id).toBe(r.id);
    expect((await prisma.vanLot.aggregate({ where: { loadId }, _sum: { qtySold: true } }))._sum.qtySold).toBe(6);
    expect(Number((await prisma.vanLoad.findUniqueOrThrow({ where: { id: loadId } })).cashExpected)).toBeCloseTo(r.paid, 2);
    // more than the van holds
    await expect(V.sellFromVan(sc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 999 }], method: "ON_ACCOUNT", signedBy: "Karim" })).rejects.toThrow(/Not enough/);
  });

  it("FIRINGI's switches: methods, cash limit, signature", async () => {
    const admin = await ctxFor(ADMIN), sc = await sellerCtx();
    await V.saveVanSalesSettings(admin, { methods: { CASH: true, CARD: false, MB_WAY: true, ON_ACCOUNT: true }, maxCashPerSale: 1 });
    await expect(V.sellFromVan(sc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 1 }], method: "CARD", signedBy: "Karim" })).rejects.toThrow(/payment method/);
    await expect(V.sellFromVan(sc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 5 }], method: "CASH", signedBy: "Karim" })).rejects.toThrow(/Cash is limited/);
    await expect(V.sellFromVan(sc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 1 }], method: "MB_WAY", signedBy: "" })).rejects.toThrow(/signature/);
    await V.setVendorVanSales(admin, lxId, false);
    await expect(V.sellFromVan(sc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 1 }], method: "MB_WAY", signedBy: "Karim" })).rejects.toThrow(/switched off/);
    await prisma.setting.deleteMany({ where: { key: "vansales.settings" } });
  });

  it("end of the day: leftovers back to the warehouse, missing written off, cash counted; cash netted from payouts", async () => {
    const sc = await sellerCtx(), lx = await ctxFor(LX);
    const load = await prisma.vanLoad.findUniqueOrThrow({ where: { id: loadId } });
    const before = await onHand();
    const r = await V.closeLoad(sc, loadId, { counted: { [rice]: 32 }, cashCounted: Number(load.cashExpected) - 2, note: "2 € short" });
    expect(r.lostUnits).toBe(2); // 40 loaded − 6 sold − 32 back
    expect(r.variance).toBeCloseTo(-2, 2);
    expect(await onHand()).toBe(before + 32);
    const d = await V.loadDetail(lx, loadId);
    expect(d.status).toBe("CLOSED");
    expect(d.products[0]).toMatchObject({ loaded: 40, sold: 6, back: 32, lost: 2, left: 0 });
    await expect(V.closeLoad(sc, loadId, { counted: {}, cashCounted: 0 })).rejects.toThrow(/on the road/);
    // the money the seller took for FIRINGI: netted against an open supplier invoice
    const owed = await V.cashOwed(lxId);
    expect(owed.toNumber()).toBeGreaterThan(0);
    const vi = await prisma.vendorInvoice.create({ data: { vendorCompanyId: lxId, externalNumber: `VAN-T-${Date.now()}`, docType: "INVOICE", status: "APPROVED", issueDate: new Date(), netTotal: 1000, vatTotal: 0, grossTotal: 1000, fileKey: "test/van.pdf" } });
    const netted = await V.netVanCash(lxId, null);
    expect(netted.toNumber()).toBeCloseTo(owed.toNumber(), 2);
    expect((await V.cashOwed(lxId)).toNumber()).toBeCloseTo(0, 2);
    const pay = await prisma.paymentAllocation.findFirstOrThrow({ where: { vendorInvoiceId: vi.id }, include: { payment: true } });
    expect(pay.payment.reference).toMatch(/Compensação/);
  });
});
