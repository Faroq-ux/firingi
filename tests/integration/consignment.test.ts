/**
 * Phase 65: consignment stock — both channels (wholesaler → shop, distributor → wholesaler). A new site waits for
 * FIRINGI's approval; stock sent leaves the warehouse; the customer confirms what arrived (short = written off);
 * a count → the other side confirms → FIRINGI orders and invoices the used goods to the customer (lots first to
 * expire first); a disputed count is replaced by a recount; unused goods go back; the job confirms unanswered counts;
 * FIRINGI's switches (per channel, per supplier).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setStock } from "@/server/services/vendor-catalogue";
import * as C from "@/server/consignment/service";
import { ctxFor } from "../helpers";

const LX = "owner@lisboacentral.test", KB = "owner@kebabhouse.test", AT = "owner@atlantico.test", ADMIN = "superadmin@firingi.test";
let lxId = "", kbId = "", atId = "", rice = "", whId = "", kbAddr = "", siteId = "";
const onHand = async (offerId = rice, addressId = whId) => (await prisma.stockLevel.findUniqueOrThrow({ where: { offerId_addressId: { offerId, addressId } } })).onHand;
const shelf = async (id = siteId) => (await C.siteDetail(await ctxFor(LX), id)).products.find((p) => p.offerId === rice);

async function clean() {
  await prisma.setting.deleteMany({ where: { key: "consignment.settings" } });
  const sites = await prisma.consignmentSite.findMany({ where: { vendorCompanyId: { in: [lxId, atId] } }, select: { id: true } });
  const ids = sites.map((s) => s.id);
  await prisma.consignmentLot.deleteMany({ where: { siteId: { in: ids } } });
  await prisma.consignmentShipment.deleteMany({ where: { siteId: { in: ids } } });
  await prisma.consignmentCount.deleteMany({ where: { siteId: { in: ids } } });
  await prisma.consignmentSite.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KB), at = await ctxFor(AT);
  lxId = lx.company.id; kbId = kb.company.id; atId = at.company.id;
  await clean();
  whId = (await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: "WAREHOUSE", isActive: true } })).id;
  rice = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, vendorSku: "GRO-ARROZ1", status: "ACTIVE" }, orderBy: { createdAt: "asc" } })).id;
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: rice, addressId: whId } } });
  await setStock(lx, rice, whId, Math.max(500, (cur?.reserved ?? 0) + 300));
  kbAddr = (await prisma.address.findFirstOrThrow({ where: { companyId: kbId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("consignment stock: wholesaler → shop", () => {
  it("a new site waits for FIRINGI's approval; no stock before", async () => {
    const lx = await ctxFor(LX), admin = await ctxFor(ADMIN);
    expect((await C.consignmentCustomers(lx, "Kebab")).some((c) => c.id === kbId)).toBe(true);
    const s = await C.createSite(lx, { buyerCompanyId: kbId, addressId: kbAddr, warehouseId: whId, countEveryDays: 7, counter: "EITHER" });
    siteId = s.id;
    expect(s.status).toBe("PENDING");
    await expect(C.createSite(lx, { buyerCompanyId: kbId, addressId: kbAddr, warehouseId: whId })).rejects.toThrow(/already/);
    await expect(C.sendStock(lx, siteId, [{ offerId: rice, qty: 5 }])).rejects.toThrow(/approved/);
    expect((await C.adminOverview(admin)).pending.some((p) => p.id === siteId && p.channel === "WHOLESALER_CUSTOMER")).toBe(true);
    await expect(C.decideSite(lx, siteId, true)).rejects.toThrow();
    await expect(C.decideSite(admin, siteId, false)).rejects.toThrow(/why/);
    expect((await C.decideSite(admin, siteId, true)).status).toBe("ACTIVE");
  });

  it("stock sent leaves the warehouse; the shop confirms 19 of 20 (1 written off)", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KB);
    expect((await C.shippableProducts(lx, siteId, "GRO-ARROZ1")).some((p) => p.offerId === rice)).toBe(true);
    const before = await onHand();
    const sh = await C.sendStock(lx, siteId, [{ offerId: rice, qty: 20 }]);
    expect(await onHand()).toBe(before - 20);
    expect((await shelf())!).toMatchObject({ inTransit: 20, onShelf: 0 });
    await expect(C.submitCount(kb, siteId, {})).rejects.toThrow(/nothing on the shelf/);
    await expect(C.receiveShipment(kb, sh.id, { [rice]: 21 })).rejects.toThrow();
    expect((await C.receiveShipment(kb, sh.id, { [rice]: 19 })).short).toBe(1);
    expect(await onHand()).toBe(before - 20);
    expect((await shelf())!).toMatchObject({ onShelf: 19, short: 1, inTransit: 0 });
    expect(await prisma.stockMovement.count({ where: { refType: "CONSIGNMENT", refId: siteId, type: "WRITE_OFF" } })).toBe(1);
    const mine = await C.myConsignment(kb);
    expect(mine[0].products[0].value).toBeNull(); // the shop doesn't see the supplier's cost
  });

  it("the shop counts 12 left; the supplier confirms → FIRINGI orders and invoices 7 to the shop", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KB);
    const c = await C.submitCount(kb, siteId, { [rice]: 12 });
    expect(c).toMatchObject({ status: "SUBMITTED", usedUnits: 7 });
    await expect(C.submitCount(lx, siteId, { [rice]: 12 })).rejects.toThrow(/waiting/);
    await expect(C.decideCount(kb, c.id, true)).rejects.toThrow(/other side/);
    const r = await C.decideCount(lx, c.id, true);
    expect(r.status).toBe("INVOICED");
    const row = await prisma.consignmentCount.findUniqueOrThrow({ where: { id: c.id } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: row.orderId! }, include: { lines: true } });
    expect(order).toMatchObject({ status: "DELIVERED", buyerCompanyId: kbId, sellerCompanyId: lxId });
    expect(order.lines[0]).toMatchObject({ offerId: rice, qtyDelivered: 7 });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id, docType: { not: "CREDIT_NOTE" } } });
    expect(inv.recipientCompanyId).toBe(kbId);
    expect(Number(row.grossTotal)).toBeCloseTo(Number(inv.grossTotal), 2);
    expect(await prisma.stockMovement.count({ where: { orderId: order.id, type: "SHIPMENT", refType: "CONSIGNMENT" } })).toBeGreaterThanOrEqual(1);
    expect((await shelf())!).toMatchObject({ onShelf: 12, used: 7 });
  });

  it("a disputed count is replaced by a recount; the job confirms an unanswered one", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KB);
    const c = await C.submitCount(lx, siteId, { [rice]: 8 });
    await expect(C.decideCount(kb, c.id, false)).rejects.toThrow(/why/);
    expect((await C.decideCount(kb, c.id, false, "We still have 10")).status).toBe("DISPUTED");
    const c2 = await C.submitCount(lx, siteId, { [rice]: 10 });
    expect((await prisma.consignmentCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("SUPERSEDED");
    await prisma.consignmentCount.update({ where: { id: c2.id }, data: { countedAt: new Date(Date.now() - 4 * 86400_000) } });
    const j = await C.processConsignment();
    expect(j.confirmed).toBeGreaterThanOrEqual(1);
    expect((await prisma.consignmentCount.findUniqueOrThrow({ where: { id: c2.id } })).status).toBe("INVOICED");
    expect((await shelf())!).toMatchObject({ onShelf: 10, used: 9 });
  });

  it("unused goods go back to the warehouse; the site closes when empty", async () => {
    const lx = await ctxFor(LX);
    await expect(C.closeSite(lx, siteId)).rejects.toThrow(/left/);
    await expect(C.pickUp(lx, siteId, { [rice]: 11 })).rejects.toThrow(/more than/);
    const before = await onHand();
    expect((await C.pickUp(lx, siteId, { [rice]: 10 })).units).toBe(10);
    expect(await onHand()).toBe(before + 10);
    await C.closeSite(lx, siteId);
    expect((await prisma.consignmentSite.findUniqueOrThrow({ where: { id: siteId } })).status).toBe("CLOSED");
  });
});

describe("consignment stock: distributor → wholesaler, FIRINGI's switches", () => {
  it("a distributor places stock with a wholesaler; the wholesaler is billed for what it used", async () => {
    const at = await ctxFor(AT), lx = await ctxFor(LX), admin = await ctxFor(ADMIN);
    const lxAddr = await prisma.address.findFirst({ where: { companyId: lxId, kind: "DELIVERY", isActive: true } });
    const atWh = await prisma.address.findFirst({ where: { companyId: atId, kind: "WAREHOUSE", isActive: true } });
    const offer = atWh && (await prisma.stockLevel.findFirst({ where: { addressId: atWh.id, offer: { vendorCompanyId: atId, status: "ACTIVE" } }, select: { offerId: true } }));
    expect(lxAddr && atWh && offer).toBeTruthy();
    expect((await C.consignmentCustomers(at, "Lisboa")).some((c) => c.id === lxId)).toBe(true);
    expect((await C.consignmentCustomers(at, "Kebab")).some((c) => c.id === kbId)).toBe(false); // a shop isn't a distributor's customer
    await C.saveConsignmentSettings(admin, { requireApproval: false });
    const s = await C.createSite(at, { buyerCompanyId: lxId, addressId: lxAddr!.id, warehouseId: atWh!.id });
    expect(s.status).toBe("ACTIVE");
    await setStock(at, offer!.offerId, atWh!.id, 200);
    const sh = await C.sendStock(at, s.id, [{ offerId: offer!.offerId, qty: 6 }]);
    await C.receiveShipment(lx, sh.id, {});
    const c = await C.submitCount(lx, s.id, { [offer!.offerId]: 4 });
    const r = await C.decideCount(at, c.id, true);
    expect(r.status).toBe("INVOICED");
    const row = await prisma.consignmentCount.findUniqueOrThrow({ where: { id: c.id } });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: row.orderId!, docType: { not: "CREDIT_NOTE" } } });
    expect(inv.recipientCompanyId).toBe(lxId);
  });

  it("FIRINGI switches a channel and a supplier off", async () => {
    const at = await ctxFor(AT), lx = await ctxFor(LX), admin = await ctxFor(ADMIN);
    await C.saveConsignmentSettings(admin, { channels: { DISTRIBUTOR_WHOLESALER: false, WHOLESALER_CUSTOMER: true } });
    const site = await prisma.consignmentSite.findFirstOrThrow({ where: { vendorCompanyId: atId, status: "ACTIVE" } });
    await expect(C.sendStock(at, site.id, [{ offerId: (await prisma.consignmentLot.findFirstOrThrow({ where: { siteId: site.id } })).offerId, qty: 1 }])).rejects.toThrow(/switched off/);
    expect((await C.vendorOverview(lx)).on).toBe(true);
    await C.setVendorConsignment(admin, lxId, false);
    expect((await C.vendorOverview(lx)).on).toBe(false);
    await expect(C.createSite(lx, { buyerCompanyId: kbId, addressId: kbAddr, warehouseId: whId })).rejects.toThrow(/switched off/);
    await expect(C.saveConsignmentSettings(lx, { enabled: false })).rejects.toThrow();
  });
});
