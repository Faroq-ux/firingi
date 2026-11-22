/**
 * Phase 60: substitutions — the supplier replaces short units with another of its products; the customer's rule
 * decides (never / ask / automatic within limits); accepted replacements become their own order line at the
 * customer's price (or price-matched, paid by the supplier), with stock, totals and the invoice following.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { addToCart, clearCart } from "@/server/services/cart";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import { reservedFor } from "@/server/inventory/ledger";
import { itemsToMove } from "@/server/allocation/engine";
import * as SUB from "@/server/substitutions/service";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test", OPS = "ops@firingi.test", FIR_DRIVER = "driver@firingi.test";
const PNG = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "sig.png", { type: "image/png" });
let arroz = "", farinha = "", azeite = "", addressId = "", kebabId = "", arrozProduct = "";

async function order(items: { offerId: string; qty: number }[]) {
  const kb = await ctxFor(KEBAB);
  await clearCart(kb);
  for (const i of items) await addToCart(kb, i.offerId, i.qty);
  const id = (await placeOrder(kb, { deliveryAddressId: addressId })).id;
  await confirmOrder(await ctxFor(LX), id, {});
  return id;
}
const line = (orderId: string, offerId: string) => prisma.orderLine.findFirstOrThrow({ where: { orderId, offerId, substituteForLineId: null } });
const held = async (orderId: string, offerId: string) => (await prisma.$transaction((tx) => reservedFor(tx, orderId))).filter((r) => r.offerId === offerId).reduce((a, r) => a + r.qty, 0);

/** Order totals equal the sum of the lines (+ the unchanged delivery fee). */
async function expectConsistent(orderId: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  const goods = o.lines.reduce((a, l) => a.plus(l.lineNet), new Decimal(0));
  expect(Number(o.netTotal)).toBeCloseTo(goods.plus(o.deliveryFeeNet).toNumber(), 2);
  expect(Number(o.grandTotal)).toBeCloseTo(Number(o.netTotal) + Number(o.vatTotal), 2);
  for (const l of o.lines) expect(Number(l.lineNet)).toBeCloseTo(Number(l.unitSalePriceNet) * (l.qtyConfirmed ?? l.qtyOrdered), 1);
  return o;
}

async function deliver(orderId: string) {
  const lx = await ctxFor(LX);
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
  if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
  await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
  await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
  await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
  const drv = await ctxFor(FIR_DRIVER);
  await pickUp(drv, d.id);
  await startDelivery(drv, d.id);
  await completeDelivery(drv, d.id, { recipientName: "Ahmed", signature: PNG });
  return prisma.invoice.findFirstOrThrow({ where: { orderId, docType: "INVOICE" }, include: { lines: true } });
}

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  kebabId = kb.company.id;
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const ids: Record<string, string> = {};
  for (const sku of ["GRO-ARROZ1", "GRO-FARINHA25", "GRO-AZEITE75"]) {
    const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: sku, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
    await setStock(lx, o.id, wh.id, Math.max(500, (cur?.reserved ?? 0) + 300));
    ids[sku] = o.id;
  }
  [arroz, farinha, azeite] = [ids["GRO-ARROZ1"], ids["GRO-FARINHA25"], ids["GRO-AZEITE75"]];
  arrozProduct = (await prisma.vendorOffer.findUniqueOrThrow({ where: { id: arroz }, select: { packaging: { select: { variant: { select: { productId: true } } } } } })).packaging.variant.productId;
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
});
beforeEach(async () => {
  await prisma.setting.deleteMany({ where: { key: "substitutions.settings" } });
  await prisma.substitutionPreference.deleteMany({ where: { companyId: kebabId } });
  await prisma.substitutionProductRule.deleteMany({ where: { companyId: kebabId } });
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "substitutions.settings" } });
  await prisma.substitutionPreference.deleteMany({ where: { companyId: kebabId } });
  await prisma.substitutionProductRule.deleteMany({ where: { companyId: kebabId } });
  await prisma.substituteLink.deleteMany({ where: { offerId: arroz } });
  await prisma.$disconnect();
});

describe("substitutions", () => {
  it("ask: short units leave the line; accepted → a new line, stock, totals and the invoice follow", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const id = await order([{ offerId: arroz, qty: 10 }, { offerId: azeite, qty: 1 }]);
    const before = await prisma.order.findUniqueOrThrow({ where: { id } });
    const cands = await SUB.candidatesFor(lx, (await line(id, arroz)).id);
    expect(cands.line.qty).toBe(10);
    expect(cands.rule.mode).toBe("ASK");

    const p = await SUB.propose(lx, { lineId: (await line(id, arroz)).id, shortQty: 4, substituteOfferId: farinha, qty: 1, note: "Out of rice" });
    expect(p.status).toBe("PENDING");
    expect((await line(id, arroz)).qtyConfirmed).toBe(6);
    expect(await held(id, arroz)).toBe(6);
    const mid = await expectConsistent(id);
    expect(Number(mid.grandTotal)).toBeLessThan(Number(before.grandTotal));
    // while waiting: not moved to another supplier, no second proposal for the line
    expect((await itemsToMove({ ...mid, lines: mid.lines }, "SHORTFALL")).find((i) => i.offerId === arroz)).toBeUndefined();
    await expect(SUB.propose(lx, { lineId: (await line(id, arroz)).id, shortQty: 1, substituteOfferId: farinha, qty: 1 })).rejects.toThrow(/already waiting/);
    const view = await SUB.forOrder(kb, id);
    expect(view.items[0]).toMatchObject({ status: "PENDING", original: { qty: 4 }, substitute: { qty: 1 } });

    expect(await SUB.decide(kb, p.id, true)).toBe("ACCEPTED");
    const sub = await prisma.substitution.findUniqueOrThrow({ where: { id: p.id } });
    expect(sub.status).toBe("ACCEPTED");
    const nl = await prisma.orderLine.findUniqueOrThrow({ where: { id: sub.newLineId! } });
    expect(nl).toMatchObject({ offerId: farinha, qtyOrdered: 1, qtyConfirmed: 1, substituteForLineId: (await line(id, arroz)).id });
    expect(Number(nl.unitSalePriceNet)).toBeCloseTo(Number(sub.unitPriceNet), 4);
    expect((await line(id, arroz)).substitutedQty).toBe(4);
    expect(await held(id, farinha)).toBe(1);
    const after = await expectConsistent(id);
    expect((await itemsToMove({ ...after, lines: after.lines }, "SHORTFALL")).length).toBe(0);
    await expect(SUB.decide(kb, p.id, false)).rejects.toThrow(/already decided/);

    const inv = await deliver(id);
    const fl = inv.lines.find((l) => l.orderLineId === nl.id);
    expect(fl).toBeTruthy();
    expect(Number(fl!.qty)).toBe(1);
    expect(Number(inv.netTotal)).toBeCloseTo(Number((await prisma.order.findUniqueOrThrow({ where: { id } })).netTotal), 2);
  });

  it("never: the customer's product rule refuses replacements", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    await SUB.setProductRule(kb, arrozProduct, "NEVER");
    const id = await order([{ offerId: arroz, qty: 10 }]);
    await expect(SUB.propose(lx, { lineId: (await line(id, arroz)).id, shortQty: 1, substituteOfferId: farinha, qty: 1 })).rejects.toThrow(/doesn't accept/);
    expect((await line(id, arroz)).qtyConfirmed).toBe(10);
    expect((await SUB.myPreferences(kb)).products[0]).toMatchObject({ productId: arrozProduct, mode: "NEVER" });
  });

  it("automatic within the price limit; over it → asked; FIRINGI can switch automatic off", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB), sa = await ctxFor(SA);
    const rice = Number((await prisma.priceListItem.findFirstOrThrow({ where: { offerId: arroz, priceList: { scope: "BASE" } }, orderBy: { minQty: "asc" } })).unitPriceNet);
    await SUB.savePreferences(kb, { mode: "AUTO", maxPricePct: 100, sameBrandOnly: false, acceptOnTimeout: false });
    const a = await order([{ offerId: arroz, qty: 10 }]);
    const auto = await SUB.propose(lx, { lineId: (await line(a, arroz)).id, shortQty: 2, substituteOfferId: azeite, qty: 1 });
    expect(auto).toMatchObject({ status: "ACCEPTED", auto: true });
    expect((await prisma.substitution.findUniqueOrThrow({ where: { id: auto.id } })).auto).toBe(true);
    await expectConsistent(a);

    await SUB.savePreferences(kb, { mode: "AUTO", maxPricePct: 0, sameBrandOnly: false, acceptOnTimeout: false });
    const b = await order([{ offerId: arroz, qty: 10 }]);
    const asked = await SUB.propose(lx, { lineId: (await line(b, arroz)).id, shortQty: 1, substituteOfferId: azeite, qty: 5 });
    expect(asked.status).toBe("PENDING");
    expect(Number((await prisma.substitution.findUniqueOrThrow({ where: { id: asked.id } })).priceDiffPct)).toBeGreaterThan(0);
    expect(rice).toBeGreaterThan(0);

    await SUB.savePreferences(kb, { mode: "AUTO", maxPricePct: 100, sameBrandOnly: false, acceptOnTimeout: false });
    await SUB.saveSubstitutionSettings(sa, { allowAuto: false });
    const c = await order([{ offerId: arroz, qty: 10 }]);
    expect((await SUB.propose(lx, { lineId: (await line(c, arroz)).id, shortQty: 1, substituteOfferId: azeite, qty: 1 })).status).toBe("PENDING");
    await SUB.saveSubstitutionSettings(sa, { enabled: false });
    await expect(SUB.propose(lx, { lineId: (await line(c, arroz)).id, shortQty: 1, substituteOfferId: farinha, qty: 1 })).rejects.toThrow(/switched off/);
  });

  it("same price: the supplier pays the difference, FIRINGI's commission stays on the list price", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const id = await order([{ offerId: arroz, qty: 10 }]);
    const orig = await line(id, arroz);
    const p = await SUB.propose(lx, { lineId: orig.id, shortQty: 1, substituteOfferId: azeite, qty: 2, priceMatch: true });
    const s = await prisma.substitution.findUniqueOrThrow({ where: { id: p.id } });
    expect(Number(s.unitPriceNet) * 2).toBeLessThanOrEqual(Number(orig.unitSalePriceNet) + 0.0001);
    expect(Number(s.priceDiffPct)).toBeLessThanOrEqual(0);
    await SUB.decide(kb, p.id, true);
    const nl = await prisma.orderLine.findUniqueOrThrow({ where: { id: (await prisma.substitution.findUniqueOrThrow({ where: { id: p.id } })).newLineId! } });
    expect(Number(nl.unitSalePriceNet)).toBeCloseTo(Number(s.unitPriceNet), 4);
    expect(Number(nl.vendorFundedDiscount)).toBeGreaterThan(0);
    expect(Number(nl.commissionBase)).toBeCloseTo(Number(nl.unitListPriceNet) * 2, 2);
    await expectConsistent(id);
  });

  it("rejected / not answered: the units stay short; the customer's time-out choice is followed", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const a = await order([{ offerId: arroz, qty: 10 }]);
    const r = await SUB.propose(lx, { lineId: (await line(a, arroz)).id, shortQty: 2, substituteOfferId: farinha, qty: 1 });
    expect(await SUB.decide(kb, r.id, false, "No thanks")).toBe("REJECTED");
    expect((await line(a, arroz)).qtyConfirmed).toBe(8);
    expect(await prisma.orderLine.count({ where: { orderId: a, substituteForLineId: { not: null } } })).toBe(0);
    // the rejected units may be proposed again (another product)
    const again = await SUB.candidatesFor(lx, (await line(a, arroz)).id);
    expect(again.line.alreadyShort).toBe(2);

    const b = await order([{ offerId: arroz, qty: 10 }]);
    const e1 = await SUB.propose(lx, { lineId: (await line(b, arroz)).id, shortQty: 1, substituteOfferId: farinha, qty: 1 });
    await prisma.substitution.update({ where: { id: e1.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await SUB.processExpired();
    expect((await prisma.substitution.findUniqueOrThrow({ where: { id: e1.id } })).status).toBe("EXPIRED");

    await SUB.savePreferences(kb, { mode: "ASK", maxPricePct: 10, sameBrandOnly: false, acceptOnTimeout: true });
    const c = await order([{ offerId: arroz, qty: 10 }]);
    const e2 = await SUB.propose(lx, { lineId: (await line(c, arroz)).id, shortQty: 1, substituteOfferId: farinha, qty: 1 });
    await prisma.substitution.update({ where: { id: e2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await SUB.processExpired();
    expect(await prisma.substitution.findUniqueOrThrow({ where: { id: e2.id } })).toMatchObject({ status: "ACCEPTED", auto: true });
    await expectConsistent(c);
  });

  it("only the order's supplier proposes, only the customer decides; the supplier may withdraw", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const id = await order([{ offerId: arroz, qty: 10 }]);
    const lineId = (await line(id, arroz)).id;
    await expect(SUB.propose(kb, { lineId, shortQty: 1, substituteOfferId: farinha, qty: 1 })).rejects.toThrow();
    const other = await prisma.membership.findFirst({ where: { company: { type: "WHOLESALER", legalName: { not: { contains: "Lisboa Central" } } }, isOwner: true, status: "ACTIVE" }, select: { user: { select: { email: true } } } });
    if (other) await expect(SUB.propose(await ctxFor(other.user.email), { lineId, shortQty: 1, substituteOfferId: farinha, qty: 1 })).rejects.toThrow();
    const p = await SUB.propose(lx, { lineId, shortQty: 1, substituteOfferId: farinha, qty: 1 });
    await expect(SUB.decide(lx, p.id, true)).rejects.toThrow();
    await SUB.withdraw(lx, p.id);
    expect((await prisma.substitution.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("CANCELLED");
    // the supplier's chosen replacements come first
    await SUB.setSubstituteLinks(lx, arroz, [farinha]);
    const c = await SUB.candidatesFor(lx, lineId);
    expect(c.candidates[0]).toMatchObject({ offerId: farinha, linked: true });
    expect((await SUB.adminOverview(await ctxFor(SA))).totals.proposed).toBeGreaterThan(0);
    await expect(SUB.adminOverview(kb)).rejects.toThrow();
  });
});
