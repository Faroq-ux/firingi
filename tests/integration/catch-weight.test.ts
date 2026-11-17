/**
 * Phase 41: sold by weight — a 2 kg mozzarella block sold per kg: settings, the supplier's product setup (prices
 * scaled so the price per kg stays), weights at picking / by scale label / on the order page / by the driver,
 * the over-weight limit (capped unless the customer accepts), invoice + supplier statement on the real weight,
 * pay-before-shipping with a buffer (unused part stays as credit), "weigh before dispatch", reports.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { addToCart, clearCart } from "@/server/services/cart";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import { paymentPolicy, setPaymentPolicy } from "@/server/services/payments";
import { buyerPayOrder, customerCredit, openAmounts, startPayment } from "@/server/payments/service";
import { simCheckout } from "@/server/payments/sim-actions";
import { creditInvoice } from "@/server/invoicing/service";
import * as CW from "@/server/catchweight/service";
import { DEFAULT_CATCH_WEIGHT_SETTINGS } from "@/lib/catch-weight";
import * as A from "@/server/app/service";
import { ctxFor } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test", OPS = "ops@firingi.test", FIR_DRIVER = "driver@firingi.test";
const PNG = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "sig.png", { type: "image/png" });
let mozz = "", arroz = "", addressId = "", kebabId = "", unitPrice = 0;

/** EAN-13 check digit. */
const ean = (twelve: string) => {
  const sum = twelve.split("").map(Number).reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return twelve + ((10 - (sum % 10)) % 10);
};

async function toDriver(orderId: string) {
  const lx = await ctxFor(LX);
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
  if (d.mode !== "FIRINGI_FLEET") await prisma.delivery.update({ where: { id: d.id }, data: { mode: "FIRINGI_FLEET", executingCompanyId: (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id } });
  await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: d.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
  await assignDelivery(await ctxFor(OPS), d.id, { driverId: driver.id });
  await changeOrderStatus(lx, orderId, "READY_FOR_PICKUP");
  return d.id;
}
async function deliver(orderId: string, stop: { weights?: Record<string, number>; acceptOver?: boolean } = {}) {
  const id = await toDriver(orderId);
  const drv = await ctxFor(FIR_DRIVER);
  await pickUp(drv, id);
  await startDelivery(drv, id);
  await completeDelivery(drv, id, { recipientName: "Ahmed", signature: PNG, ...stop });
  return prisma.invoice.findFirstOrThrow({ where: { orderId, docType: "INVOICE" }, include: { lines: { orderBy: { position: "asc" } } } });
}
async function order(items: { offerId: string; qty: number }[]) {
  const kb = await ctxFor(KEBAB);
  await clearCart(kb);
  for (const i of items) await addToCart(kb, i.offerId, i.qty);
  return (await placeOrder(kb, { deliveryAddressId: addressId })).id;
}
const mozzLine = (orderId: string) => prisma.orderLine.findFirstOrThrow({ where: { orderId, offerId: mozz } });

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  kebabId = kb.company.id;
  await prisma.setting.deleteMany({ where: { key: "catchweight.settings" } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  for (const sku of ["GRO-MOZZ2", "GRO-ARROZ1"]) {
    const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: sku, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
    await setStock(lx, o.id, wh.id, Math.max(400, (cur?.reserved ?? 0) + 300));
    if (sku === "GRO-MOZZ2") mozz = o.id; else arroz = o.id;
  }
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  await prisma.vendorOffer.update({ where: { id: mozz }, data: { cwMode: null, cwNominalKg: null, cwMinKg: null, cwMaxKg: null, cwMaxOverPct: null, cwPlu: null } });
  unitPrice = Number((await prisma.priceListItem.findFirstOrThrow({ where: { offerId: mozz, priceList: { scope: "BASE" } }, orderBy: { minQty: "asc" } })).unitPriceNet);
});
afterAll(async () => {
  await prisma.vendorOffer.update({ where: { id: mozz }, data: { cwMode: null, cwNominalKg: null, cwMinKg: null, cwMaxKg: null, cwMaxOverPct: null, cwPlu: null } }).catch(() => null);
  await prisma.setting.deleteMany({ where: { key: "catchweight.settings" } });
  await prisma.$disconnect();
});

describe("settings and products", () => {
  it("FIRINGI sets the limits; the supplier sets a product up and the price per kg stays when the weight changes", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    await expect(CW.saveCatchWeightSettings(sa, { ...DEFAULT_CATCH_WEIGHT_SETTINGS, maxOverPct: { default: 80 } })).rejects.toThrow(/between 0 and 50/);
    await expect(CW.saveCatchWeightSettings(lx, DEFAULT_CATCH_WEIGHT_SETTINGS)).rejects.toThrow();
    await CW.saveCatchWeightSettings(sa, { ...DEFAULT_CATCH_WEIGHT_SETTINGS, maxOverPct: { default: 10, PT: 8 } });
    await expect(CW.saveOfferCatchWeight(lx, { offerId: mozz, mode: "PIECE", nominalKg: 2, minKg: 2.3, maxKg: 1.8 })).rejects.toThrow(/lightest piece/);
    await expect(CW.saveOfferCatchWeight(lx, { offerId: mozz, mode: "PIECE", nominalKg: null })).rejects.toThrow(/required/);
    await expect(CW.saveOfferCatchWeight(lx, { offerId: mozz, mode: "PIECE", nominalKg: 2, plu: "12a" })).rejects.toThrow(/4 to 6 digits/);
    await CW.saveOfferCatchWeight(lx, { offerId: mozz, mode: "PIECE", nominalKg: 2, minKg: 1.8, maxKg: 2.3, maxOverPct: 5, plu: "41234" });
    let view = (await CW.vendorCatchWeightOffers(lx, "pt-PT")).offers.find((o) => o.id === mozz)!;
    expect(view).toMatchObject({ mode: "PIECE", nominalKg: 2, minKg: 1.8, maxKg: 2.3, maxOverPct: 5, plu: "41234", unitPrice, perKg: unitPrice / 2 });
    // 2 kg → 2.5 kg: every price of the offer × 1.25, price per kg unchanged; and back
    await CW.saveOfferCatchWeight(lx, { offerId: mozz, mode: "PIECE", nominalKg: 2.5, minKg: 1.8, maxKg: 2.6, maxOverPct: 5, plu: "41234" });
    view = (await CW.vendorCatchWeightOffers(lx, "pt-PT")).offers.find((o) => o.id === mozz)!;
    expect(view.unitPrice).toBeCloseTo(unitPrice * 1.25, 4);
    expect(view.perKg).toBeCloseTo(unitPrice / 2, 4);
    await CW.saveOfferCatchWeight(lx, { offerId: mozz, mode: "PIECE", nominalKg: 2, minKg: 1.8, maxKg: 2.3, maxOverPct: 5, plu: "41234" });
    expect((await CW.vendorCatchWeightOffers(lx, "pt-PT")).offers.find((o) => o.id === mozz)!.unitPrice).toBeCloseTo(unitPrice, 4);
    const buyerInfo = await CW.offerCatchWeight([mozz, arroz]);
    expect(buyerInfo.get(mozz)).toEqual({ mode: "PIECE", nominalKg: 2, minKg: 1.8, maxKg: 2.3 });
    expect(buyerInfo.has(arroz)).toBe(false);
  });
});

describe("weights and billing", () => {
  it("a weighed line is billed on its weight: order total, invoice text and statement follow", async () => {
    const lx = await ctxFor(LX);
    const id = await order([{ offerId: mozz, qty: 5 }]);
    let line = await mozzLine(id);
    expect(line).toMatchObject({ cwMode: "PIECE" });
    expect(Number(line.cwNominalKg)).toBe(2);
    expect(Number(line.cwMaxOverPct)).toBe(5); // the supplier's 5 % is tighter than FIRINGI's 8 % in PT
    await expect(CW.recordWeights(lx, { orderLineId: line.id, pieces: [2] })).rejects.toThrow(/after the order is confirmed/);
    await confirmOrder(lx, id, {});
    await expect(CW.recordWeights(lx, { orderLineId: line.id, pieces: [2, -1] })).rejects.toThrow(/weight of each piece/);
    await expect(CW.recordWeights(await ctxFor(KEBAB), { orderLineId: line.id, pieces: [2] })).rejects.toThrow();
    const before = await prisma.order.findUniqueOrThrow({ where: { id } });
    const r = await CW.recordWeights(lx, { orderLineId: line.id, pieces: [2.05, 1.98, "2,1", 2.02, 1.95], source: "PICK" });
    expect(r).toMatchObject({ totalKg: 10.1, billedKg: 10.1, maxKg: 10.5, over: false, capped: false });
    line = await mozzLine(id);
    const sale = Number(line.unitSalePriceNet);
    expect(Number(line.lineNet)).toBeCloseTo(new Decimal(sale).mul(10.1).div(2).toDecimalPlaces(2).toNumber(), 2);
    const after = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(Number(after.grandTotal)).toBeGreaterThan(Number(before.grandTotal)); // 10.1 kg instead of 10
    expect(Number(after.netTotal)).toBeCloseTo(Number(before.netTotal) + sale * 0.05, 2);
    const inv = await deliver(id);
    const il = inv.lines.find((l) => l.orderLineId === line.id)!;
    expect(il.description).toContain("10,100 kg ×");
    expect(il.description).toContain("€/kg");
    expect(Number(il.qty)).toBe(5);
    expect(Number(il.lineNet)).toBe(Number(line.lineNet));
    expect(new Decimal(il.unitPriceNet.toString()).mul(5).minus(il.discountNet.toString()).toDecimalPlaces(2).toNumber()).toBe(Number(il.lineNet)); // as the fiscal provider recomputes it
    expect(Number(inv.grossTotal)).toBe(Number((await prisma.order.findUniqueOrThrow({ where: { id } })).grandTotal));
    const st = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { orderId: id, isCreditStatement: false } });
    const stl = (st.lines as { orderLineId: string; description: string; lineNet: string }[]).find((x) => x.orderLineId === line.id)!;
    expect(stl.description).toContain("10,100 kg");
    expect(Number(stl.lineNet)).toBe(Number((await mozzLine(id)).vendorLineNet));
    // a credit note per unit (claims / returns) still works: 1 of 5 units = a fifth of the line
    const cn = await prisma.$transaction((tx) => creditInvoice(tx, inv.id, { lines: [{ invoiceLineId: il.id, qty: 1 }], reason: "test", actorUserId: lx.user.id, chargeVendor: false }));
    expect(Number(cn.netTotal)).toBeCloseTo(Number(il.lineNet) / 5, 2);
  });

  it("over the limit: capped unless the customer accepts; the customer is told; the driver can correct", async () => {
    const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    // A: over, accepted by the customer before delivery → billed on the real weight
    const a = await order([{ offerId: mozz, qty: 2 }, { offerId: arroz, qty: 4 }]);
    await confirmOrder(lx, a, {});
    const la = await mozzLine(a);
    const r = await CW.recordWeights(lx, { orderLineId: la.id, pieces: [2.4, 2.3] });
    expect(r).toMatchObject({ totalKg: 4.7, maxKg: 4.2, over: true, capped: true, billedKg: 4.2 });
    expect(await prisma.notificationMessage.count({ where: { companyId: kebabId, eventKey: "catchweight.over_limit", refId: a } })).toBeGreaterThan(0);
    const view = await CW.orderWeights(kb, a, "BUYER", "pt-PT");
    expect(view.canAccept).toBe(true);
    expect(view.lines[0]).toMatchObject({ actualKg: 4.7, billedKg: 4.2, over: true, capped: true, accepted: false });
    await expect(CW.orderWeights(kb, a, "SUPPLIER", "pt-PT")).rejects.toThrow();
    await CW.acceptOverWeight(kb, a);
    await expect(CW.acceptOverWeight(kb, a)).rejects.toThrow(/Nothing above/);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "catchweight.over_accepted", refId: a } })).toBeGreaterThan(0);
    const invA = await deliver(a);
    expect(invA.lines.find((l) => l.orderLineId === la.id)!.description).toContain("4,700 kg");
    // B: over, not accepted, the driver weighs again at the stop: 4.1 kg → billed 4.1
    const b = await order([{ offerId: mozz, qty: 2 }, { offerId: arroz, qty: 4 }]);
    await confirmOrder(lx, b, {});
    const lb = await mozzLine(b);
    await CW.recordWeights(lx, { orderLineId: lb.id, pieces: [2.4, 2.3] });
    const invB = await deliver(b, { weights: { [lb.id]: 4.1 } });
    expect(invB.lines.find((l) => l.orderLineId === lb.id)!.description).toContain("4,100 kg");
    const hist = await prisma.catchWeighing.findMany({ where: { orderLineId: lb.id }, orderBy: { at: "asc" } });
    expect(hist.map((h) => h.source)).toEqual(["SUPPLIER", "DRIVER"]);
    // C: over, nobody accepts → capped at the limit
    const c = await order([{ offerId: mozz, qty: 2 }, { offerId: arroz, qty: 4 }]);
    await confirmOrder(lx, c, {});
    const lc = await mozzLine(c);
    await CW.recordWeights(lx, { orderLineId: lc.id, pieces: [2.4, 2.3] });
    const invC = await deliver(c);
    expect(invC.lines.find((l) => l.orderLineId === lc.id)!.description).toContain("4,200 kg");
    expect(Number((await mozzLine(c)).cwBilledKg)).toBe(4.2);
    // D: the customer accepts at the stop (the driver ticks it) → real weight
    const dd = await order([{ offerId: mozz, qty: 2 }, { offerId: arroz, qty: 4 }]);
    await confirmOrder(lx, dd, {});
    const ld = await mozzLine(dd);
    await CW.recordWeights(lx, { orderLineId: ld.id, pieces: [2.4, 2.3] });
    await deliver(dd, { acceptOver: true });
    expect(Number((await mozzLine(dd)).cwBilledKg)).toBe(4.7);
  });

  it("not weighed → billed on the estimate", async () => {
    const lx = await ctxFor(LX);
    const id = await order([{ offerId: mozz, qty: 5 }]);
    await confirmOrder(lx, id, {});
    const inv = await deliver(id);
    const l = await mozzLine(id);
    expect(Number(l.cwBilledKg)).toBe(10);
    expect(inv.lines.find((x) => x.orderLineId === l.id)!.description).toContain("10,000 kg");
  });
});

describe("scale labels", () => {
  it("EAN-13 2x and GS1 labels add pieces; other products' labels are refused", async () => {
    const lx = await ctxFor(LX);
    const id = await order([{ offerId: mozz, qty: 3 }, { offerId: arroz, qty: 2 }]);
    await confirmOrder(lx, id, {});
    const l = await mozzLine(id);
    expect((await CW.scanWeightLabel(lx, l.id, "hello")).outcome).toBe("NOT_A_LABEL");
    expect((await CW.scanWeightLabel(lx, l.id, ean("289999902150"))).outcome).toBe("WRONG_ITEM"); // item 99999
    expect(await CW.scanWeightLabel(lx, l.id, ean("284123402150"))).toMatchObject({ outcome: "OK", kg: 2.15, totalKg: 2.15, pieces: 1 });
    expect(await CW.scanWeightLabel(lx, l.id, "(3103)001980")).toMatchObject({ outcome: "OK", kg: 1.98, totalKg: 4.13, pieces: 2 });
    expect((await CW.scanWeightLabel(lx, l.id, "(01)05600000000017(3103)002000")).outcome).toBe("WRONG_ITEM"); // another GTIN
    // the picking scan path (Phase 25) uses the same label rules
    expect(await CW.pickLabel(lx, id, mozz, ean("284123402010"))).toMatchObject({ ok: true, kg: 2.01, totalKg: 6.14 });
    expect(await CW.pickLabel(lx, id, mozz, "5602000000209")).toBeNull(); // a plain barcode isn't a scale label
    const hist = await prisma.catchWeighing.findFirstOrThrow({ where: { orderLineId: l.id }, orderBy: { at: "desc" } });
    expect(hist).toMatchObject({ source: "SCAN" });
    expect(hist.pieces).toEqual([2.15, 1.98, 2.01]);
  });
});

describe("dispatch rule, prepayment, reports", () => {
  it("FIRINGI can require weighing before dispatch", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    await CW.saveCatchWeightSettings(sa, { ...(await CW.catchWeightSettings()), requireWeighing: true });
    const id = await order([{ offerId: mozz, qty: 5 }]);
    await confirmOrder(lx, id, {});
    const did = await toDriver(id);
    const drv = await ctxFor(FIR_DRIVER);
    await expect(pickUp(drv, did)).rejects.toThrow(/Weigh the products/);
    await CW.recordWeights(lx, { orderLineId: (await mozzLine(id)).id, pieces: [2, 2, 2, 2, 2] });
    await pickUp(drv, did);
    await startDelivery(drv, did);
    await completeDelivery(drv, did, { recipientName: "Ahmed", signature: PNG });
    await CW.saveCatchWeightSettings(sa, { ...(await CW.catchWeightSettings()), requireWeighing: false });
  });

  it("pay before shipping: estimate + buffer; what isn't used stays as credit", async () => {
    const savedEnv = process.env.PAYMENTS_SIMULATE;
    process.env.PAYMENTS_SIMULATE = "1";
    const sa = await ctxFor(SA), lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
    const policy = await paymentPolicy();
    await setPaymentPolicy(sa, { ...policy, methods: { ...policy.methods, CARD: true } });
    await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: true } });
    try {
      const id = await order([{ offerId: mozz, qty: 5 }, { offerId: arroz, qty: 2 }]);
      const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      const mz = o.lines.find((l) => l.offerId === mozz)!;
      const buffer = new Decimal(mz.lineNet.toString()).plus(mz.lineVat.toString()).mul(0.1).toDecimalPlaces(2, Decimal.ROUND_UP).toNumber();
      expect(Number(o.prepayBuffer)).toBe(buffer);
      const req = await buyerPayOrder(kb, id);
      expect(Number(req.amount)).toBeCloseTo(Number(o.grandTotal) + buffer, 2);
      await startPayment(req.id, "CARD", { via: "portal" });
      await simCheckout((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } })).providerRef!, "succeeded");
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_CONFIRMATION");
      await confirmOrder(lx, id, {});
      await CW.recordWeights(lx, { orderLineId: mz.id, pieces: [1.9, 1.95, 2, 1.92, 1.98] }); // 9.75 kg
      const inv = await deliver(id);
      expect((await openAmounts([inv.id])).get(inv.id)!.toNumber()).toBe(0); // paid by the prepayment
      expect(Number(inv.grossTotal)).toBeLessThan(Number(req.amount)); // 9.75 kg < the estimate + buffer
      // the rest of the payment is the customer's credit (used on other open invoices, or kept)
      const pay = await prisma.payment.findFirstOrThrow({ where: { request: { id: req.id } }, include: { allocations: true } });
      expect(Number(pay.allocations.find((a) => a.invoiceId === inv.id)!.amount)).toBe(Number(inv.grossTotal));
      const free = (await customerCredit(kebabId)).find((c) => c.id === pay.id)?.free ?? new Decimal(0);
      const used = pay.allocations.reduce((a, x) => a + Number(x.amount), 0);
      expect(used + Number(free)).toBeCloseTo(Number(req.amount), 2);
    } finally {
      await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: false } });
      await setPaymentPolicy(sa, policy).catch(() => null);
      process.env.PAYMENTS_SIMULATE = savedEnv;
    }
  });

  it("reports: FIRINGI's overview per supplier, the supplier's per product, the driver's stop", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX);
    const ov = await CW.adminOverview(sa);
    expect(ov.offers).toBeGreaterThanOrEqual(1);
    const lxRow = ov.suppliers.find((s) => s.companyId === lx.company.id)!;
    expect(lxRow.lines).toBeGreaterThanOrEqual(6);
    expect(lxRow.capped).toBeGreaterThanOrEqual(1);
    const rep = await CW.vendorReport(lx, "pt-PT");
    expect(rep.products.find((p) => p.offerId === mozz)?.lines).toBeGreaterThanOrEqual(6);
    await expect(CW.adminOverview(lx)).rejects.toThrow();
    // an order waiting for weights shows on the supplier's list and at the driver's stop
    const id = await order([{ offerId: mozz, qty: 5 }]);
    await confirmOrder(lx, id, {});
    expect((await CW.vendorReport(lx, "pt-PT")).toWeigh.some((t) => t.orderId === id)).toBe(true);
    const did = await toDriver(id);
    const data = (await A.snapshot(await ctxFor(FIR_DRIVER), "driver", "pt-PT")).driver as unknown as { stops: { number: string; weights: { correction: boolean; lines: { estimatedKg: number }[] } }[] };
    const no = (await prisma.order.findUniqueOrThrow({ where: { id } })).number;
    expect(data.stops.find((s) => s.number === no)?.weights).toMatchObject({ correction: true, lines: [expect.objectContaining({ estimatedKg: 10 })] });
    const drv = await ctxFor(FIR_DRIVER);
    await pickUp(drv, did);
    await startDelivery(drv, did);
    await completeDelivery(drv, did, { recipientName: "Ahmed", signature: PNG });
  });
});
