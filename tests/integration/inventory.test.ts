/**
 * Phase 24: inventory & warehouses.
 *  • Ledger: batches always add up to the stock level; weighted average cost; FEFO / FIFO picking;
 *    expired stock never reserved; shipments record cost of goods; cancel after dispatch restocks
 *    the same batch; write-offs never touch reserved stock.
 *  • Purchase orders: outside supplier (PDF e-mailed, partial + full receipt, over-receipt refused);
 *    on FIRINGI (a real order at the buyer's price; receive only once delivered).
 *  • Counts (blind, variance, second person over the limit) and transfers (lots travel, lost in
 *    transit, cancel puts back).
 *  • Expiry features: FIRINGI switches per supplier, supplier requests → approve / reject; markdown
 *    suggestions; best-before for customers; daily alerts.
 *  • Who may do what.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { restockForOrder } from "@/server/inventory/ledger";
import { setStock } from "@/server/services/vendor-catalogue";
import { receiveStock, setOpeningCost, stockOverview, valuation, writeOff, reorderSuggestions, setReorder, movements } from "@/server/inventory/service";
import { cancelPurchaseOrder, createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder, saveSupplier, sendPurchaseOrder, listPurchaseOrders } from "@/server/inventory/purchasing";
import { addFoundLine, approveCount, cancelTransfer, createTransfer, getCount, getTransfer, receiveTransfer, recordCount, sendTransfer, startCount, submitCount } from "@/server/inventory/warehouse";
import { acceptMarkdown, bestBeforeFor, decideFeatureRequest, markdownSuggestions, requestFeature, resetSupplierFeatures, runExpiryAlerts, setSupplierFeature, supplierFeatures } from "@/server/inventory/expiry";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", FIN = "finance@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", ATL = "owner@atlantico.test";
const day = 86_400_000;
const inDays = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + n)); };

let lx: Awaited<ReturnType<typeof ctxFor>>, offerId: string, lisboa: string, amadora: string;

/** Batches add up to the level for the test product (levels written directly by older code are repaired lazily). */
async function invariant() {
  const levels = await prisma.stockLevel.findMany({ where: { offerId } });
  for (const l of levels) {
    const bs = await prisma.stockBatch.findMany({ where: { offerId: l.offerId, addressId: l.addressId, writtenOffAt: null } });
    const onHand = bs.reduce((a, b) => a + b.onHand, 0), reserved = bs.reduce((a, b) => a + b.reserved, 0);
    if (bs.length || l.onHand) expect({ onHand, reserved }).toEqual({ onHand: l.onHand, reserved: l.reserved });
  }
}

async function freshStock() {
  // start from nothing: no open orders holding the test offer, empty batches, no cost
  const sa = await ctxFor(SA);
  const open = await prisma.order.findMany({ where: { status: { in: ["NEW", "ON_HOLD", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP"] }, lines: { some: { offerId } } }, select: { id: true } });
  for (const o of open) await changeOrderStatus(sa, o.id, "CANCELLED", "test cleanup").catch(() => null);
  await setStock(lx, offerId, amadora, 0).catch(() => null);
  await prisma.stockBatch.deleteMany({ where: { offerId, reserved: 0 } });
  const lvl = await prisma.stockLevel.findMany({ where: { offerId } });
  for (const l of lvl) await prisma.stockLevel.update({ where: { id: l.id }, data: { onHand: l.reserved, avgCost: 0 } });
}

async function orderMozz(qty: number) {
  const kebab = await ctxFor(KEBAB);
  await clearCart(kebab);
  await addToCart(kebab, offerId, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  return placeOrder(kebab, { deliveryAddressId: addr.id });
}

beforeAll(async () => {
  lx = await ctxFor(LX);
  offerId = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } } })).id;
  lisboa = (await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE" } })).id;
  amadora = (await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "PICKUP" } })).id;
  await resetSupplierFeatures(await ctxFor(SA), lx.company.id);
});

afterAll(async () => {
  await resetSupplierFeatures(await ctxFor(SA), lx.company.id).catch(() => null);
  // leave the demo with plenty of mozzarella for the other tests
  await setStock(lx, offerId, lisboa, 900).catch(() => null);
});

describe("ledger", () => {
  it("receives lots at a weighted average cost and keeps batches = levels", async () => {
    await freshStock();
    await setStock(lx, offerId, lisboa, 10); // opening stock, no cost yet
    await setOpeningCost(lx, { offerId, addressId: lisboa, unitCost: 5 });
    await expect(setOpeningCost(lx, { offerId, addressId: lisboa, unitCost: 9 })).rejects.toThrow(/already has a cost/);
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 10, unitCost: 7, lotCode: "L-A", expiresOn: inDays(40) });
    const lvl = await prisma.stockLevel.findUniqueOrThrow({ where: { offerId_addressId: { offerId, addressId: lisboa } } });
    expect(lvl.onHand - lvl.reserved).toBeGreaterThanOrEqual(20);
    expect(Number(lvl.avgCost)).toBeCloseTo(6, 4); // (10×5 + 10×7) / 20
    // same lot + date adds to that batch
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 5, unitCost: 7, lotCode: "L-A", expiresOn: inDays(40) });
    expect(await prisma.stockBatch.count({ where: { offerId, addressId: lisboa, lotCode: "L-A" } })).toBe(1);
    await expect(receiveStock(lx, { offerId, addressId: lisboa, qty: 1, unitCost: 1, expiresOn: inDays(-1) })).rejects.toThrow(/passed/);
    await invariant();
  });

  it("FEFO reserves the batch that expires first; FIFO when FIRINGI turns FEFO off; never expired stock", async () => {
    await freshStock();
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 20, unitCost: 6, lotCode: "OLD-LATE", expiresOn: inDays(60) });
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 20, unitCost: 6, lotCode: "NEW-SOON", expiresOn: inDays(10) });
    const expired = await prisma.stockBatch.create({ data: { offerId, addressId: lisboa, lotCode: "GONE", expiresOn: inDays(-2), onHand: 50, source: "RECEIPT", unitCost: 6 } });
    await prisma.stockLevel.update({ where: { offerId_addressId: { offerId, addressId: lisboa } }, data: { onHand: { increment: 50 } } });

    const o1 = await orderMozz(5);
    const r1 = await prisma.stockMovement.findMany({ where: { orderId: o1.id, type: "RESERVE" }, include: { batch: true } });
    expect(r1.map((m) => m.batch?.lotCode)).toEqual(["NEW-SOON"]);
    expect(r1.some((m) => m.batchId === expired.id)).toBe(false);

    await setSupplierFeature(await ctxFor(SA), lx.company.id, "FEFO", false);
    const o2 = await orderMozz(5);
    const r2 = await prisma.stockMovement.findMany({ where: { orderId: o2.id, type: "RESERVE" }, include: { batch: true } });
    expect(r2.map((m) => m.batch?.lotCode)).toEqual(["OLD-LATE"]); // received first
    await setSupplierFeature(await ctxFor(SA), lx.company.id, "FEFO", true);

    // only 35 usable (the 50 expired don't count) → an order of 40 is refused
    const kebab = await ctxFor(KEBAB);
    await clearCart(kebab);
    await expect(orderMozz(40)).rejects.toThrow();
    await invariant();
    // the expired batch can be written off; reserved stock can't
    await writeOff(lx, { batchId: expired.id, reason: "expired" });
    expect((await prisma.stockBatch.findUniqueOrThrow({ where: { id: expired.id } })).writtenOffAt).not.toBeNull();
    const reservedBatch = r1[0].batchId!;
    const b = await prisma.stockBatch.findUniqueOrThrow({ where: { id: reservedBatch } });
    await expect(writeOff(lx, { batchId: reservedBatch, qty: b.onHand, reason: "test" })).rejects.toThrow(/free|reserved/);
    for (const o of [o1, o2]) await changeOrderStatus(await ctxFor(SA), o.id, "CANCELLED", "test");
    await invariant();
  });

  it("shipping records cost of goods; cancelled after dispatch goes back into the same batch", async () => {
    await freshStock();
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 30, unitCost: 4, lotCode: "SHIP-1", expiresOn: inDays(30) });
    const o = await orderMozz(6);
    await confirmOrder(lx, o.id, {});
    const sa = await ctxFor(SA);
    for (const to of ["READY_FOR_PICKUP", "DISPATCHED"] as const) await changeOrderStatus(sa, o.id, to, "test").catch(async () => changeOrderStatus(lx, o.id, to, "test"));
    const ship = await prisma.stockMovement.findMany({ where: { orderId: o.id, type: "SHIPMENT" } });
    expect(ship.reduce((a, m) => a + m.qty, 0)).toBe(6);
    expect(Number(ship[0].unitCost)).toBeCloseTo(4, 4);
    const v = await valuation(lx, { from: new Date(Date.now() - day), to: new Date(Date.now() + day) });
    expect(Number(v.cogs)).toBeGreaterThanOrEqual(24);
    const batchId = ship[0].batchId!;
    const before = (await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchId } })).onHand;
    await prisma.$transaction((tx) => restockForOrder(tx, o.id)); // what a cancel after dispatch / a return does
    expect((await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchId } })).onHand).toBe(before + 6);
    await invariant();
  });
});

describe("purchase orders", () => {
  it("outside supplier: PDF by e-mail, partial then full receipt, average cost moves", async () => {
    await freshStock();
    await setStock(lx, offerId, lisboa, 10);
    await setOpeningCost(lx, { offerId, addressId: lisboa, unitCost: 10 });
    const sup = await saveSupplier(lx, { name: `Lacticínios Teste ${Date.now()}`, email: "encomendas@lacticinios.test", leadTimeDays: 3 });
    await expect(createPurchaseOrder(lx, { supplierId: sup.id, addressId: lisboa, lines: [{ offerId, qty: 10 }] })).rejects.toThrow(/cost/);
    const po = await createPurchaseOrder(lx, { supplierId: sup.id, addressId: lisboa, expectedOn: inDays(3), lines: [{ offerId, qty: 30, unitCost: 8 }] });
    expect(po.number).toMatch(/^PO-\d{4}-\d{6}$/);
    const outbox = path.resolve(process.env.STORAGE_DIR ?? "./storage", "mail-outbox");
    const sent = await sendPurchaseOrder(lx, po.id);
    expect(sent.emailed).toBe(true);
    const files = (await readdir(outbox)).filter((f) => f.endsWith(`${po.number}.pdf`)).sort(); // newest last (earlier test runs may have used the same number)
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect((await readFile(path.join(outbox, files.at(-1)!))).subarray(0, 4).toString()).toBe("%PDF");

    const view = await getPurchaseOrder(lx, po.id);
    const lineId = view.lines[0].id;
    await receivePurchaseOrder(lx, po.id, { lines: [{ lineId, qty: 10, lotCode: "PO-L1", expiresOn: inDays(20) }] });
    expect((await getPurchaseOrder(lx, po.id)).status).toBe("PARTIALLY_RECEIVED");
    await expect(receivePurchaseOrder(lx, po.id, { lines: [{ lineId, qty: 21 }] })).rejects.toThrow(/still to receive/);
    await receivePurchaseOrder(lx, po.id, { lines: [{ lineId, qty: 20, lotCode: "PO-L2", expiresOn: inDays(25) }] });
    const done = await getPurchaseOrder(lx, po.id);
    expect(done.status).toBe("RECEIVED");
    expect(done.receipts).toHaveLength(2);
    const lvl = await prisma.stockLevel.findUniqueOrThrow({ where: { offerId_addressId: { offerId, addressId: lisboa } } });
    expect(Number(lvl.avgCost)).toBeCloseTo((10 * 10 + 30 * 8) / 40, 3);
    await expect(cancelPurchaseOrder(lx, po.id)).rejects.toThrow(/received/);
    expect((await listPurchaseOrders(lx)).some((p) => p.id === po.id && p.received === 30)).toBe(true);
    await invariant();
  });

  it("on FIRINGI: sending places a real order at the buyer's price; receive only once delivered", async () => {
    const atl = await ctxFor(ATL);
    const src = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: atl.company.id, vendorSku: "DIS-COLA33", status: "ACTIVE" } });
    const own = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-COLA33", packaging: { unitsPerPack: 24 } } });
    const atlWh = await prisma.address.findFirstOrThrow({ where: { companyId: atl.company.id, kind: "WAREHOUSE" } });
    await setStock(atl, src.id, atlWh.id, 500);
    const po = await createPurchaseOrder(lx, { sellerCompanyId: atl.company.id, addressId: lisboa, lines: [{ offerId: own.id, sourceOfferId: src.id, qty: 4 }] });
    const sent = await sendPurchaseOrder(lx, po.id);
    expect(sent.order?.number).toMatch(/^FO-/);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: sent.order!.id }, include: { lines: true } });
    expect(order.buyerCompanyId).toBe(lx.company.id);
    expect(order.lines[0].qtyOrdered).toBe(4);
    const view = await getPurchaseOrder(lx, po.id);
    expect(view.lines[0].unitCost.toString()).toBe(order.lines[0].unitSalePriceNet.toString()); // never the distributor's payout
    expect(view.canReceive).toBe(false);
    await expect(receivePurchaseOrder(lx, po.id, { lines: [{ lineId: view.lines[0].id, qty: 4 }] })).rejects.toThrow(/delivered/);
    await expect(cancelPurchaseOrder(lx, po.id)).rejects.toThrow(/FIRINGI order/);
    // delivery itself is covered elsewhere — mark it delivered the way the order flow records it
    await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED", statusHistory: { create: { fromStatus: order.status, toStatus: "DELIVERED", reason: "test" } } } });
    const ready = await getPurchaseOrder(lx, po.id);
    expect(ready.canReceive).toBe(true);
    expect(ready.toReceive[0].open).toBe(4);
    await receivePurchaseOrder(lx, po.id, { lines: [{ lineId: ready.lines[0].id, qty: 4, lotCode: "ATL-1", expiresOn: inDays(200) }] });
    expect((await getPurchaseOrder(lx, po.id)).status).toBe("RECEIVED");
    // a distributor can't buy on FIRINGI through a purchase order
    await expect(createPurchaseOrder(atl, { sellerCompanyId: atl.company.id, addressId: atlWh.id, lines: [{ offerId: src.id, sourceOfferId: src.id, qty: 1 }] })).rejects.toThrow(/wholesalers/);
  });

  it("reorder suggestions use reorder points and incoming stock", async () => {
    await freshStock();
    // nothing on the way (the demo has an open purchase order for this product) — incoming stock
    // would rightly hold the suggestion back
    await prisma.purchaseOrder.updateMany({ where: { ownerCompanyId: lx.company.id, status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, lines: { some: { offerId } } }, data: { status: "CANCELLED" } });
    await setStock(lx, offerId, lisboa, 3);
    await setReorder(lx, { offerId, addressId: lisboa, reorderPoint: 10, reorderQty: 40 });
    const s = (await reorderSuggestions(lx)).find((r) => r.offer.id === offerId && r.addressId === lisboa);
    expect(s?.suggestedQty).toBe(40);
    expect(s?.supplier).not.toBeNull(); // last purchase order's supplier
    await setReorder(lx, { offerId, addressId: lisboa, reorderPoint: null, reorderQty: null });
  });
});

describe("counts and transfers", () => {
  it("blind count, variance, second person over the limit, posts only the difference", async () => {
    await freshStock();
    await setStock(lx, offerId, lisboa, 50);
    await setOpeningCost(lx, { offerId, addressId: lisboa, unitCost: 10 });
    const c = await startCount(lx, { addressId: lisboa, kind: "CYCLE", offerIds: [offerId] });
    await expect(startCount(lx, { addressId: lisboa, kind: "FULL" })).rejects.toThrow(/still open/);
    const open = await getCount(lx, c.id);
    expect(open.lines.every((l) => l.expectedQty === null)).toBe(true); // blind
    await expect(submitCount(lx, c.id)).rejects.toThrow(/not counted/);
    await recordCount(lx, c.id, open.lines.map((l, i) => ({ lineId: l.id, countedQty: i === 0 ? 20 : 0 })));
    await addFoundLine(lx, c.id, { offerId, countedQty: 1 });
    await submitCount(lx, c.id);
    const sub = await getCount(lx, c.id);
    const expected = sub.lines.reduce((a, l) => a + (l.expectedQty ?? 0), 0);
    expect(expected).toBe(50);
    expect(sub.varianceQty).toBe(20 + 1 - 50);
    expect(Number(sub.varianceValue)).toBeCloseTo(-290, 2); // over the 250 € limit
    // the owner may approve their own; a warehouse user may not
    expect(sub.canApprove).toBe(true);
    await approveCount(lx, c.id);
    const lvl = await prisma.stockLevel.findUniqueOrThrow({ where: { offerId_addressId: { offerId, addressId: lisboa } } });
    expect(lvl.onHand - lvl.reserved).toBe(21);
    expect(await prisma.stockMovement.count({ where: { refType: "COUNT", refId: c.id } })).toBeGreaterThan(0);
    await invariant();
  });

  it("transfers move lots with their dates; lost in transit; cancel puts back", async () => {
    await freshStock();
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 12, unitCost: 3, lotCode: "TR-1", expiresOn: inDays(15) });
    await expect(createTransfer(lx, { fromAddressId: lisboa, toAddressId: lisboa, lines: [{ offerId, qty: 1 }] })).rejects.toThrow(/different/);
    const t = await createTransfer(lx, { fromAddressId: lisboa, toAddressId: amadora, lines: [{ offerId, qty: 10 }] });
    await sendTransfer(lx, t.id);
    const sent = await getTransfer(lx, t.id);
    expect(sent.status).toBe("IN_TRANSIT");
    expect(sent.lines[0].picks[0].lotCode).toBe("TR-1");
    await receiveTransfer(lx, t.id, [{ lineId: sent.lines[0].id, qty: 9 }]);
    const arrived = await prisma.stockBatch.findFirstOrThrow({ where: { offerId, addressId: amadora, lotCode: "TR-1" } });
    expect(arrived.onHand).toBe(9);
    expect(arrived.expiresOn?.toISOString().slice(0, 10)).toBe(inDays(15).toISOString().slice(0, 10));
    expect(JSON.stringify((await prisma.auditLog.findFirstOrThrow({ where: { entityId: t.id, action: "stock_transfer.received" } })).after)).toMatch(/lostInTransit.*"qty":1/);

    const t2 = await createTransfer(lx, { fromAddressId: amadora, toAddressId: lisboa, lines: [{ offerId, qty: 4 }] });
    await sendTransfer(lx, t2.id);
    await cancelTransfer(lx, t2.id);
    expect((await prisma.stockBatch.findFirstOrThrow({ where: { offerId, addressId: amadora, lotCode: "TR-1" } })).onHand).toBe(9);
    await invariant();
    expect((await movements(lx, { offerId })).some((m) => m.type === "TRANSFER_OUT")).toBe(true);
  });
});

describe("expiry features", () => {
  it("FIRINGI switches per supplier; supplier asks, FIRINGI approves or rejects", async () => {
    const sa = await ctxFor(SA);
    await resetSupplierFeatures(sa, lx.company.id);
    const row = (await supplierFeatures(sa)).find((s) => s.id === lx.company.id)!;
    expect(row.custom).toBe(false);
    expect(row.features.markdown).toBe(false);
    const r = await requestFeature(lx, "MARKDOWN", true, "lots of short-dated dairy");
    await expect(requestFeature(lx, "MARKDOWN", true)).rejects.toThrow(/already asked/);
    await expect(requestFeature(lx, "FEFO", true)).rejects.toThrow(/already on/);
    await expect(decideFeatureRequest(sa, r.id, false)).rejects.toThrow(/why/);
    await expect(decideFeatureRequest(lx, r.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await decideFeatureRequest(sa, r.id, true);
    expect((await supplierFeatures(sa)).find((s) => s.id === lx.company.id)!.features.markdown).toBe(true);
    const r2 = await requestFeature(lx, "SHOW_EXPIRY", true);
    await decideFeatureRequest(sa, r2.id, false, "Not for this category yet");
    expect((await prisma.inventoryFeatureRequest.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("REJECTED");
    await expect(setSupplierFeature(await ctxFor(FIN), lx.company.id, "FEFO", false)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("markdown suggestions, best-before for customers, daily alerts", async () => {
    const sa = await ctxFor(SA);
    await freshStock();
    // far more than sells in 5 days at the usual pace (other tests ship this product too)
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 5000, unitCost: 5, lotCode: "SHORT", expiresOn: inDays(5) });
    await setSupplierFeature(sa, lx.company.id, "MARKDOWN", false);
    expect((await markdownSuggestions(lx)).enabled).toBe(false);
    await setSupplierFeature(sa, lx.company.id, "MARKDOWN", true);
    const sug = (await markdownSuggestions(lx)).rows.find((r) => r.lotCode === "SHORT");
    expect(sug?.percent).toBe(25);
    const promo = await acceptMarkdown(lx, sug!.batchId, sug!.percent);
    const p = await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id }, include: { targets: true } });
    expect(p.targets[0].offerId).toBe(offerId);
    expect(p.validTo!.toISOString().slice(0, 10)).toBe(inDays(5).toISOString().slice(0, 10));
    await prisma.promotion.update({ where: { id: promo.id }, data: { status: "ENDED" } });

    expect((await bestBeforeFor([offerId])).has(offerId)).toBe(false); // SHOW_EXPIRY off
    await setSupplierFeature(sa, lx.company.id, "SHOW_EXPIRY", true);
    expect((await bestBeforeFor([offerId])).get(offerId)?.toISOString().slice(0, 10)).toBe(inDays(5).toISOString().slice(0, 10));

    await receiveStock(lx, { offerId, addressId: lisboa, qty: 3, unitCost: 5, lotCode: "SEVEN", expiresOn: inDays(7) });
    const before = await prisma.notification.count({ where: { userId: lx.user.id, type: "inventory.expiring" } });
    const res = await runExpiryAlerts();
    expect(res.messages).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: lx.user.id, type: "inventory.expiring" } })).toBeGreaterThan(before);
    await resetSupplierFeatures(sa, lx.company.id);
  });
});

describe("access", () => {
  it("another supplier and customers can't see or touch it", async () => {
    const atl = await ctxFor(ATL), kebab = await ctxFor(KEBAB);
    const mine = (await listPurchaseOrders(lx))[0];
    await expect(getPurchaseOrder(atl, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(stockOverview(kebab)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await stockOverview(atl)).every((r) => r.offer.id !== offerId)).toBe(true);
    await expect(supplierFeatures(lx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
