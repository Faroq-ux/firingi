/**
 * Phase 62: sales reps — the manager makes a company user a rep (role given), assigns a customer and plans a visit;
 * the rep checks in, closes the visit and takes orders at the customer's prices; the customer confirms (or lets the
 * supplier's reps order directly); every order from the rep's customer carries the rep; delivered net → commission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";
import { addToCart, clearCart } from "@/server/services/cart";
import { placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import * as R from "@/server/salesreps/service";
import { ctxFor } from "../helpers";

const LX = "owner@lisboacentral.test", KB = "owner@kebabhouse.test";
let lxId = "", kbId = "", repUserId = "", repId = "", rice = "", addressId = "";
const repCtx = async () => (await loadContext(repUserId, "t", lxId))!;

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KB);
  lxId = lx.company.id; kbId = kb.company.id;
  await prisma.setting.deleteMany({ where: { key: "salesreps.settings" } });
  await prisma.repOrderPreference.deleteMany({ where: { buyerCompanyId: kbId } });
  const u = await prisma.user.create({ data: { email: `rep.${Date.now()}@lisboacentral.test`, name: "Rita Rep" } });
  repUserId = u.id;
  await prisma.membership.create({ data: { userId: u.id, companyId: lxId } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, vendorSku: "GRO-ARROZ1", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  rice = o.id;
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
  await setStock(lx, o.id, wh.id, Math.max(500, (cur?.reserved ?? 0) + 300));
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kbId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
});
afterAll(async () => {
  await prisma.repAssignment.deleteMany({ where: { vendorCompanyId: lxId } });
  await prisma.salesRep.deleteMany({ where: { userId: repUserId } });
  await prisma.repOrderPreference.deleteMany({ where: { buyerCompanyId: kbId } });
  await prisma.$disconnect();
});

describe("sales reps", () => {
  it("the manager makes a rep (role given), assigns a customer, plans a visit; the rep works the visit", async () => {
    const lx = await ctxFor(LX);
    expect((await R.team(lx)).candidates.some((c) => c.userId === repUserId)).toBe(true);
    repId = await R.saveRep(lx, { userId: repUserId, commissionPct: 3, monthlyTarget: 20000 });
    const rc = await repCtx();
    expect(rc.permissions.has("vendor.reps.field")).toBe(true);
    await expect(R.planVisit(lx, { repId, buyerCompanyId: kbId, date: new Date().toISOString().slice(0, 10) })).rejects.toThrow(/assigned/);
    expect((await R.assignableCustomers(lx, "Kebab")).some((c) => c.id === kbId)).toBe(true);
    await R.assignCustomer(lx, kbId, repId);
    await R.planVisit(lx, { repId, buyerCompanyId: kbId, date: new Date().toISOString().slice(0, 10), note: "Show the new olive oil" });
    const d = await R.myDay(rc);
    expect(d.visits[0]).toMatchObject({ buyerCompanyId: kbId, status: "PLANNED", note: "Show the new olive oil" });
    expect(d.customers.some((c) => c.id === kbId)).toBe(true);
    const visitId = await R.checkIn(rc, { buyerCompanyId: kbId, latitude: 38.7105, longitude: -9.1366 });
    expect(visitId).toBe(d.visits[0].id);
    await R.finishVisit(rc, visitId, { outcome: "FOLLOW_UP", note: "Call back Friday" });
    expect((await prisma.repVisit.findUniqueOrThrow({ where: { id: visitId } }))).toMatchObject({ status: "DONE", outcome: "FOLLOW_UP" });
  });

  it("the rep takes an order; the customer confirms at its own prices; the orders carry the rep", async () => {
    const rc = await repCtx(), kb = await ctxFor(KB);
    const card = await R.customerCard(rc, kbId);
    expect(card.addresses.length).toBeGreaterThan(0);
    const products = await R.productsForCustomer(rc, kbId, "arroz");
    expect(products.some((p) => p.offerId === rice && p.unitNet > 0)).toBe(true);
    const t = await R.takeOrder(rc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 10 }], note: "As agreed" });
    expect(t.status).toBe("PENDING");
    const mine = await R.pendingForMe(kb);
    const p = mine.items.find((x) => x.id === t.id)!;
    expect(p.lines[0]).toMatchObject({ offerId: rice, qty: 10 });
    expect(p.rep).toBe("Rita Rep");
    const r = await R.decideRepOrder(kb, t.id, true);
    expect(r.status).toBe("PLACED");
    const orders = await prisma.order.findMany({ where: { number: { in: r.orderNumbers } } });
    expect(orders.length).toBe(1);
    expect(orders[0].salesRepId).toBe(repId);
    await expect(R.decideRepOrder(kb, t.id, true)).rejects.toThrow(/already/);
  });

  it("customer lets the supplier's reps order directly; rejects; unconfirmed orders expire", async () => {
    const rc = await repCtx(), kb = await ctxFor(KB);
    await R.setAutoConfirm(kb, lxId, true);
    const a = await R.takeOrder(rc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 10 }] });
    expect(a.status).toBe("PLACED");
    expect((await prisma.repOrder.findUniqueOrThrow({ where: { id: a.id } })).auto).toBe(true);
    await R.setAutoConfirm(kb, lxId, false);
    const b = await R.takeOrder(rc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 10 }] });
    expect((await R.decideRepOrder(kb, b.id, false)).status).toBe("REJECTED");
    const c = await R.takeOrder(rc, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 10 }] });
    await prisma.repOrder.update({ where: { id: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await R.processSalesReps();
    expect((await prisma.repOrder.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("EXPIRED");
    expect((await R.myRepOrders(rc)).length).toBeGreaterThanOrEqual(3);
  });

  it("every order from the rep's customer carries the rep; delivered net gives the commission", async () => {
    const kb = await ctxFor(KB), lx = await ctxFor(LX);
    await clearCart(kb);
    await addToCart(kb, rice, 10);
    const placed = await placeOrder(kb, { deliveryAddressId: addressId });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(o.salesRepId).toBe(repId);
    // delivered this month (status + history, as the delivery flow writes them)
    await prisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
    await prisma.orderStatusHistory.create({ data: { orderId: o.id, fromStatus: o.status, toStatus: "DELIVERED", reason: "test" } });
    const t = await R.team(lx);
    const row = t.reps.find((r) => r.id === repId)!;
    expect(row.delivered).toBeGreaterThanOrEqual(Number(o.netTotal) - Number(o.deliveryFeeNet) - 0.01);
    expect(row.commission).toBeCloseTo(row.delivered * 0.03, 1);
    expect(row.targetPct).not.toBeNull();
    expect(row.visitsDone).toBeGreaterThanOrEqual(1);
    expect(await R.resultsCsv(lx)).toMatch(/Rita Rep/);
  });

  it("rights: customers and other companies can't act as reps or managers", async () => {
    const kb = await ctxFor(KB), lx = await ctxFor(LX);
    await expect(R.takeOrder(kb, { buyerCompanyId: kbId, addressId, items: [{ offerId: rice, qty: 10 }] })).rejects.toThrow();
    await expect(R.team(kb)).rejects.toThrow();
    await expect(R.myDay(lx)).rejects.toThrow(/not an active sales rep/);
    const sa = await ctxFor("superadmin@firingi.test");
    expect((await R.adminOverview(sa)).reps.some((r) => r.id === repId)).toBe(true);
    await R.saveSalesRepSettings(sa, { enabled: false });
    await expect(R.checkIn(await repCtx(), { buyerCompanyId: kbId })).rejects.toThrow(/switched off/);
    await prisma.setting.deleteMany({ where: { key: "salesreps.settings" } });
  });
});
