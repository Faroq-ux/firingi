/**
 * Phase 25: warehouse operations & traceability.
 *  • Shelves: ranges, put-away of a whole lot / part of a lot (split keeps the family), rules.
 *  • Scanning: FIRINGI label codes, lot numbers, shelf codes, order numbers, GTIN check digit.
 *  • Pick & pack: list from the orders' reservations in shelf order; scan-verified picking (wrong lot /
 *    item / shelf refused); short pick counts the shelf out and re-covers from other lots; packing
 *    marks the order ready; packing slip and box labels.
 *  • Recalls: a distributor's lot followed into a wholesaler's stock and on to its customer; every
 *    level blocked, open orders moved to other lots, open pick lists corrected, every buyer told;
 *    who sees which buyers; buyers acknowledge and report; access rules.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { receiveStock } from "@/server/inventory/service";
import { stockDeliveredOrder } from "@/server/inventory/purchased";
import { createBin, createBinRange, listBins, putAway, updateBin, binDetail } from "@/server/warehouse/bins";
import { parseScan, resolveScan, validGtin } from "@/server/warehouse/scan";
import { cancelPickList, confirmPick, createPickList, getPickList, packOrder, pickableOrders, pickLists, reportShort, scanPick } from "@/server/warehouse/picking";
import { boxLabelsPdf, binLabelsPdf, lotLabelsPdf, packingSlipPdf } from "@/server/warehouse/documents";
import { acknowledgeRecall, closeRecall, getRecall, listRecalls, myRecallNotices, reportRecallAction, startRecall, traceLot } from "@/server/warehouse/recalls";
import { featureOn, resetWarehouseFeatures, setWarehouseFeature, supplierWarehouseFeatures, warehouseFeatures } from "@/server/warehouse/features";
import { resolveNav } from "@/config/nav/resolve";
import { VENDOR_NAV } from "@/config/nav/portals";
import { hiddenWarehouseNav } from "@/server/warehouse/features";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", OPS = "ops@firingi.test", FIN = "finance@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", ATL = "owner@atlantico.test";
const inDays = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
const OPEN = ["NEW", "ON_HOLD", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP"] as const;

let lx: Awaited<ReturnType<typeof ctxFor>>, offerId: string, lisboa: string, amadora: string;

/** Nothing of the offer anywhere: open orders cancelled, batches gone, levels at 0. */
async function emptyOffer(id: string) {
  const sa = await ctxFor(SA);
  const open = await prisma.order.findMany({ where: { status: { in: [...OPEN] }, lines: { some: { offerId: id } } }, select: { id: true } });
  for (const o of open) await changeOrderStatus(sa, o.id, "CANCELLED", "test cleanup").catch(() => null);
  await prisma.stockBatch.updateMany({ where: { offerId: id, reserved: 0 }, data: { onHand: 0, binId: null } });
  const lvl = await prisma.stockLevel.findMany({ where: { offerId: id } });
  for (const l of lvl) await prisma.stockLevel.update({ where: { id: l.id }, data: { onHand: l.reserved } });
}

async function buy(buyerEmail: string, offer: string, qty: number) {
  const c = await ctxFor(buyerEmail);
  await clearCart(c);
  await addToCart(c, offer, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: c.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  return placeOrder(c, { deliveryAddressId: addr.id });
}

async function sellerCtx(orderId: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { sellerCompanyId: true } });
  const owner = await prisma.membership.findFirstOrThrow({ where: { companyId: o.sellerCompanyId, isOwner: true }, include: { user: true } });
  return ctxFor(owner.user.email);
}

async function deliver(orderId: string) {
  const sc = await sellerCtx(orderId), ops = await ctxFor(OPS);
  if ((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status === "PENDING_CONFIRMATION") await confirmOrder(sc, orderId, {});
  for (const to of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const cur = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status;
    if (cur === "DELIVERED") break;
    if (to === "READY_FOR_PICKUP" && cur !== "SUPPLIER_PROCESSING") continue;
    await changeOrderStatus(ops, orderId, to).catch(() => changeOrderStatus(sc, orderId, to));
  }
  expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");
}

async function invariant(id: string) {
  for (const l of await prisma.stockLevel.findMany({ where: { offerId: id } })) {
    const bs = await prisma.stockBatch.findMany({ where: { offerId: id, addressId: l.addressId, writtenOffAt: null, blockedAt: null } });
    expect({ onHand: bs.reduce((a, b) => a + b.onHand, 0), reserved: bs.reduce((a, b) => a + b.reserved, 0) }).toEqual({ onHand: l.onHand, reserved: l.reserved });
  }
}

beforeAll(async () => {
  lx = await ctxFor(LX);
  offerId = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } } })).id;
  lisboa = (await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE" } })).id;
  amadora = (await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "PICKUP" } })).id;
});

afterAll(async () => {
  await setStock(lx, offerId, lisboa, 900).catch(() => null);
});

describe("shelves", () => {
  it("creates a range of shelves in walking order, skipping codes that exist", async () => {
    const r = await createBinRange(lx, { addressId: lisboa, aisles: "a, b", racks: 2, levels: 2, zone: "Frio" });
    expect(r.created + r.skipped).toBe(8);
    const again = await createBinRange(lx, { addressId: lisboa, aisles: "A,B", racks: 2, levels: 2 });
    expect(again).toEqual({ created: 0, skipped: 8 });
    const bins = (await listBins(lx, lisboa)).map((b) => b.code);
    expect(bins.slice(0, 4)).toEqual(["A-01-1", "A-01-2", "A-02-1", "A-02-2"]);
    await expect(createBin(lx, { addressId: lisboa, code: "a-01-1" })).rejects.toThrow(/already exists/);
    await expect(createBin(lx, { addressId: lisboa, code: "!!" })).rejects.toThrow(/letters/);
    await expect(createBinRange(lx, { addressId: lisboa, aisles: "A", racks: 100, levels: 1 })).rejects.toThrow(/Racks/);
    // another supplier's warehouse is not ours
    const atl = await ctxFor(ATL);
    await expect(createBin(atl, { addressId: lisboa, code: "X-1" })).rejects.toThrow(/warehouse/);
    expect(await listBins(atl, lisboa)).toEqual([]);
  });

  it("puts a whole lot or a part of it on a shelf; a part keeps its family", async () => {
    await emptyOffer(offerId);
    const lot = `SH-${Date.now()}`;
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 10, unitCost: 4, lotCode: lot, expiresOn: inDays(30) });
    const batch = await prisma.stockBatch.findFirstOrThrow({ where: { offerId, lotCode: lot } });
    const bins = await listBins(lx, lisboa);
    const a11 = bins.find((b) => b.code === "A-01-1")!, b21 = bins.find((b) => b.code === "B-02-1")!;
    await putAway(lx, { batchId: batch.id, binId: a11.id });
    expect((await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } })).binId).toBe(a11.id);
    await expect(putAway(lx, { batchId: batch.id, binId: a11.id })).rejects.toThrow(/already on this shelf/);
    const part = await putAway(lx, { batchId: batch.id, binId: b21.id, qty: 4 });
    expect(part.batchId).not.toBe(batch.id);
    const piece = await prisma.stockBatch.findUniqueOrThrow({ where: { id: part.batchId } });
    expect(piece).toMatchObject({ lotCode: lot, onHand: 4, splitFromId: batch.id, binId: b21.id });
    expect((await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } })).onHand).toBe(6);
    expect((await binDetail(lx, b21.id, "pt-PT")).lots.map((l) => l.lotCode)).toContain(lot);
    // a shelf with stock can't be retired; a shelf of another warehouse can't take the lot
    await expect(updateBin(lx, { id: b21.id, isActive: false })).rejects.toThrow(/Move the lots/);
    const other = await createBin(lx, { addressId: amadora, code: `AM-${Date.now() % 100000}` });
    await expect(putAway(lx, { batchId: batch.id, binId: other.id })).rejects.toThrow(/another warehouse/);
    await invariant(offerId);
  });
});

describe("scanning", () => {
  it("reads FIRINGI codes, shelf codes, lot numbers, order numbers and barcodes", async () => {
    expect(parseScan("FIR:B:abc")).toEqual({ kind: "BATCH", id: "abc" });
    expect(parseScan(" fir:l:xyz\n")).toEqual({ kind: "BIN", id: "xyz" });
    expect(parseScan("FIR:O:FO-2026-000001:2")).toEqual({ kind: "ORDER", id: "FO-2026-000001", box: 2 });
    expect(parseScan("5601234567890")).toEqual({ kind: "TEXT", text: "5601234567890" });
    expect(validGtin("4006381333931")).toBe(true);
    expect(validGtin("4006381333932")).toBe(false);
    expect(validGtin("96385074")).toBe(true);

    const bin = (await listBins(lx, lisboa)).find((b) => b.code === "A-01-1")!;
    const byLabel = await resolveScan(lx, `FIR:L:${bin.id}`, "pt-PT");
    expect(byLabel.kind).toBe("BIN");
    expect((await resolveScan(lx, "a-01-1", "pt-PT")).kind).toBe("BIN");
    const b = await prisma.stockBatch.findFirstOrThrow({ where: { offerId, binId: bin.id, onHand: { gt: 0 } } });
    const r = await resolveScan(lx, `FIR:B:${b.id}`, "pt-PT");
    expect(r.kind).toBe("BATCH");
    if (r.kind === "BATCH") expect(r.lots[0]).toMatchObject({ id: b.id, bin: { code: "A-01-1" } });
    expect((await resolveScan(lx, b.lotCode!, "pt-PT")).kind).toBe("BATCH");
    expect((await resolveScan(lx, "nothing-like-this", "pt-PT")).kind).toBe("UNKNOWN");
    // another supplier's label means nothing to us
    expect((await resolveScan(await ctxFor(ATL), `FIR:B:${b.id}`, "pt-PT")).kind).toBe("UNKNOWN");
    await expect(resolveScan(await ctxFor(KEBAB), "x", "pt-PT")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("pick & pack", () => {
  it("picks in shelf order with scans, handles a short pick, packs and prints", async () => {
    await emptyOffer(offerId);
    const t = Date.now();
    const soon = `PK1-${t}`, later = `PK2-${t}`, spare = `PK3-${t}`;
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 5, unitCost: 4, lotCode: soon, expiresOn: inDays(20) });
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 3, unitCost: 4, lotCode: later, expiresOn: inDays(40) });
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 10, unitCost: 4, lotCode: spare, expiresOn: inDays(60) });
    const bins = await listBins(lx, lisboa);
    const [bSoon, bLater] = await Promise.all([soon, later].map((l) => prisma.stockBatch.findFirstOrThrow({ where: { offerId, lotCode: l } })));
    await putAway(lx, { batchId: bSoon.id, binId: bins.find((b) => b.code === "B-02-1")!.id });
    await putAway(lx, { batchId: bLater.id, binId: bins.find((b) => b.code === "A-01-2")!.id });

    const o = await buy(KEBAB, offerId, 8); // FEFO: 5 of the soonest lot + 3 of the next
    await confirmOrder(lx, o.id, {});
    expect((await pickableOrders(lx, lisboa)).map((x) => x.id)).toContain(o.id);
    const id = await createPickList(lx, { addressId: lisboa, orderIds: [o.id] });
    await expect(createPickList(lx, { addressId: lisboa, orderIds: [o.id] })).rejects.toThrow(/already on an open pick list/);
    let pl = await getPickList(lx, id, "pt-PT");
    expect(pl.lines.map((l) => [l.bin, l.lotCode, l.qty])).toEqual([["A-01-2", later, 3], ["B-02-1", soon, 5]]); // shelf order, not lot order

    const [first, second] = pl.lines;
    expect((await scanPick(lx, first.id, "garbage")).outcome).toBe("WRONG_ITEM");
    expect((await scanPick(lx, first.id, `FIR:B:${bSoon.id}`)).outcome).toBe("WRONG_LOT");
    expect((await scanPick(lx, first.id, soon)).outcome).toBe("WRONG_LOT");
    expect((await scanPick(lx, first.id, `FIR:L:${bins[0].id}`)).outcome).toBe("SHELF");
    expect(await scanPick(lx, first.id, `FIR:B:${bLater.id}`, 3)).toEqual({ outcome: "OK", picked: 3, qty: 3 });
    expect((await scanPick(lx, first.id, later)).outcome).toBe("DONE");

    // only 3 of the 5 on the shelf: the rest is counted out, 2 come from the spare lot
    await expect(reportShort(lx, second.id, { found: 5, reason: "x" })).rejects.toThrow(/between/);
    const short = await reportShort(lx, second.id, { found: 3, reason: "damaged box" });
    expect(short).toMatchObject({ missing: 2, covered: 2, still: 0 });
    expect((await prisma.stockBatch.findUniqueOrThrow({ where: { id: bSoon.id } })).onHand).toBe(3); // shelf counted: 5 → 3 (all reserved, all shipped)
    pl = await getPickList(lx, id, "pt-PT");
    const added = pl.lines.find((l) => l.lotCode === spare)!;
    expect(added).toMatchObject({ qty: 2, pickedQty: 0, bin: null });
    expect(pl.orders[0].canPack).toBe(false);
    await expect(confirmPick(lx, added.id, 1)).rejects.toThrow(/short/);
    await confirmPick(lx, added.id, 2);
    pl = await getPickList(lx, id, "pt-PT");
    expect(pl.status).toBe("PICKED");
    expect(pl.lines.find((l) => l.id === added.id)?.verified).toBe("MANUAL");
    expect(pl.lines.find((l) => l.id === first.id)?.verified).toBe("SCAN");
    expect(pl.orders[0].canPack).toBe(true);

    await expect(packOrder(lx, { pickListId: id, orderId: o.id, boxes: 0 })).rejects.toThrow(/Boxes/);
    await packOrder(lx, { pickListId: id, orderId: o.id, boxes: 2 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("READY_FOR_PICKUP");
    expect((await getPickList(lx, id, "pt-PT")).status).toBe("PACKED");
    await expect(packOrder(lx, { pickListId: id, orderId: o.id, boxes: 2 })).rejects.toThrow(/closed|Already/);

    const slip = await packingSlipPdf(lx, id, o.id, "pt-PT");
    expect(slip.pdf.subarray(0, 4).toString()).toBe("%PDF");
    const boxes = await boxLabelsPdf(lx, id, o.id, "pt-PT");
    expect(boxes.pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect((await binLabelsPdf(lx, bins.slice(0, 3).map((b) => b.id))).subarray(0, 4).toString()).toBe("%PDF");
    expect((await lotLabelsPdf(lx, [bSoon.id, bLater.id], "pt-PT")).subarray(0, 4).toString()).toBe("%PDF");
    await expect(packingSlipPdf(await ctxFor(ATL), id, o.id, "pt-PT")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // the goods leave as picked: 3 + 3 + 2 lots shipped
    await deliver(o.id);
    const shipped = await prisma.stockMovement.findMany({ where: { orderId: o.id, type: "SHIPMENT" }, include: { batch: true } });
    expect(Object.fromEntries(shipped.map((m) => [m.batch!.lotCode, m.qty]))).toEqual({ [soon]: 3, [later]: 3, [spare]: 2 });
    await invariant(offerId);
  });

  it("a pick list can be cancelled until something is packed", async () => {
    await emptyOffer(offerId);
    await receiveStock(lx, { offerId, addressId: lisboa, qty: 10, unitCost: 4, lotCode: `CX-${Date.now()}`, expiresOn: inDays(30) });
    const o = await buy(KEBAB, offerId, 5);
    await confirmOrder(lx, o.id, {});
    const id = await createPickList(lx, { addressId: lisboa, orderIds: [o.id] });
    await cancelPickList(lx, id);
    expect((await pickableOrders(lx, lisboa)).map((x) => x.id)).toContain(o.id); // free to list again
    await expect(createPickList(lx, { addressId: lisboa, orderIds: [] })).rejects.toThrow(/at least one/);
    await expect(createPickList(await ctxFor(KEBAB), { addressId: lisboa, orderIds: [o.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("recalls", () => {
  it("follows a distributor's lot into a wholesaler's stock and on to its customer, blocks it everywhere and tells everyone", async () => {
    const atl = await ctxFor(ATL), sa = await ctxFor(SA), kebab = await ctxFor(KEBAB);
    const src = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: atl.company.id, vendorSku: "DIS-COLA33", status: "ACTIVE" } });
    const own = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-COLA33", packaging: { unitsPerPack: 24 } } });
    const atlWh = await prisma.address.findFirstOrThrow({ where: { companyId: atl.company.id, kind: "WAREHOUSE" } });
    await emptyOffer(src.id);
    await emptyOffer(own.id);
    const lot = `RC-${Date.now()}`;
    await receiveStock(atl, { offerId: src.id, addressId: atlWh.id, qty: 30, unitCost: 9, lotCode: lot, expiresOn: inDays(8) });
    await receiveStock(atl, { offerId: src.id, addressId: atlWh.id, qty: 30, unitCost: 9, lotCode: `${lot}-OK`, expiresOn: inDays(90) });

    // the wholesaler buys 6 of the lot on FIRINGI and puts them into its stock
    const o1 = await buy(LX, src.id, 10);
    await deliver(o1.id);
    await stockDeliveredOrder(lx, o1.id, lisboa);
    const lxBatch = await prisma.stockBatch.findFirstOrThrow({ where: { offerId: own.id, lotCode: lot } });
    // … plus a lot of its own from elsewhere, later best-before
    await receiveStock(lx, { offerId: own.id, addressId: lisboa, qty: 10, unitCost: 8, lotCode: `${lot}-LX`, expiresOn: inDays(120) });
    // the customer gets 4 of the recalled lot delivered, and has 4 more on order (reserved on it, on a pick list)
    const o2 = await buy(KEBAB, own.id, 4);
    await deliver(o2.id);
    const o3 = await buy(KEBAB, own.id, 4);
    await confirmOrder(lx, o3.id, {});
    expect((await prisma.stockMovement.findFirstOrThrow({ where: { orderId: o3.id, type: "RESERVE" } })).batchId).toBe(lxBatch.id);
    const pick = await createPickList(lx, { addressId: lisboa, orderIds: [o3.id] });
    // and the distributor has one more open order on the lot (another of its customers)
    const o4 = await buy(LX, src.id, 6);
    await confirmOrder(atl, o4.id, {});

    // trace before the recall: the distributor sees its stock and its buyer, not the buyer's customers
    const tr = await traceLot(atl, { offerId: src.id, lotCode: lot }, "pt-PT");
    expect(tr.levels[0].shipments.map((s) => s.number)).toContain(o1.number);
    expect(tr.levels[1]).toMatchObject({ visible: false, buyers: 1 });
    expect(tr.levels[1].shipments).toEqual([]);
    const trAdmin = await traceLot(sa, { offerId: src.id, lotCode: lot }, "en");
    expect(trAdmin.levels[1].shipments.map((s) => s.number)).toEqual([o2.number]);
    expect((await traceLot(lx, { offerId: own.id, lotCode: lot }, "pt-PT")).upstream[0]).toMatchObject({ kind: "FIRINGI", reference: o1.number });

    await expect(startRecall(lx, { offerId: src.id, lotCode: lot, recallClass: "CLASS_I", reason: "Listeria found" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startRecall(await ctxFor(FIN), { offerId: src.id, lotCode: lot, recallClass: "CLASS_I", reason: "Listeria found" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startRecall(atl, { offerId: src.id, lotCode: lot, recallClass: "CLASS_I", reason: "x" })).rejects.toThrow(/reason/);
    const notesBefore = await prisma.notification.count({ where: { type: "recall.notice" } });
    const r = await startRecall(atl, { offerId: src.id, lotCode: lot, recallClass: "CLASS_I", reason: "Listeria found in lot", instructions: "Stop selling. Keep apart for collection." });
    expect(r.recipients).toBe(2);

    // every level blocked, nothing of it left in stock
    for (const id of [lxBatch.id]) expect(await prisma.stockBatch.findUniqueOrThrow({ where: { id } })).toMatchObject({ onHand: 0, reserved: 0, recallId: r.id });
    const atlBatch = await prisma.stockBatch.findFirstOrThrow({ where: { offerId: src.id, lotCode: lot } });
    expect(atlBatch.blockedAt).not.toBeNull();
    expect(atlBatch.onHand).toBe(0);
    // the open orders moved to other lots
    const held = async (orderId: string) => {
      const m = await prisma.stockMovement.findMany({ where: { orderId, type: { in: ["RESERVE", "RELEASE"] } }, include: { batch: true } });
      const net = new Map<string, number>();
      for (const x of m) net.set(x.batch!.lotCode!, (net.get(x.batch!.lotCode!) ?? 0) + (x.type === "RESERVE" ? x.qty : -x.qty));
      return Object.fromEntries([...net].filter(([, q]) => q > 0));
    };
    expect(await held(o3.id)).toEqual({ [`${lot}-LX`]: 4 });
    expect(await held(o4.id)).toEqual({ [`${lot}-OK`]: 6 });
    const rec = await prisma.recall.findUniqueOrThrow({ where: { id: r.id } });
    expect(rec).toMatchObject({ reReserved: 10, notReReserved: 0 });
    // the open pick list now points at the other lot
    expect((await getPickList(lx, pick, "pt-PT")).lines.map((l) => l.lotCode)).toEqual([`${lot}-LX`]);
    await invariant(own.id);
    await invariant(src.id);

    // everyone who received it is told; the distributor sees its own buyer, FIRINGI sees everyone
    expect(await prisma.notification.count({ where: { type: "recall.notice" } })).toBeGreaterThan(notesBefore);
    expect(await prisma.notification.count({ where: { type: "recall.notice", userId: kebab.user.id, link: { startsWith: "/buy/orders/recalls/" } } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { type: "recall.started", user: { email: OPS } } })).toBeGreaterThan(0);
    const mine = await getRecall(atl, r.id, "pt-PT");
    expect(mine.recipients.map((p) => [p.company, p.level, p.qty])).toEqual([["Lisboa Central", 1, 10]]);
    expect(mine.hiddenRecipients).toBe(1);
    const all = await getRecall(sa, r.id, "en");
    expect(all.recipients.map((p) => p.level)).toEqual([1, 2]);
    expect(all.recipients[1]).toMatchObject({ qty: 4, orders: [{ id: o2.id, number: o2.number }] });
    expect((await listRecalls(atl)).map((x) => x.id)).toContain(r.id);
    expect((await listRecalls(lx)).map((x) => x.id)).not.toContain(r.id);
    await expect(getRecall(lx, r.id, "pt-PT")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startRecall(sa, { offerId: src.id, lotCode: lot, recallClass: "CLASS_I", reason: "again please" })).rejects.toThrow(/already recalled/);

    // the customer acknowledges and reports
    const notice = (await myRecallNotices(kebab, "pt-PT")).find((n) => n.number === r.number)!;
    expect(notice).toMatchObject({ qty: 4, status: "NOTIFIED", lotCode: lot });
    await acknowledgeRecall(kebab, notice.id);
    await expect(reportRecallAction(kebab, notice.id, { returnedQty: 5, destroyedQty: 0, noneLeft: false })).rejects.toThrow(/received 4/);
    await expect(reportRecallAction(kebab, notice.id, { returnedQty: 0, destroyedQty: 0, noneLeft: false })).rejects.toThrow(/none is left/);
    await reportRecallAction(kebab, notice.id, { returnedQty: 2, destroyedQty: 2, noneLeft: false, note: "2 opened" });
    expect((await myRecallNotices(kebab, "pt-PT")).find((n) => n.id === notice.id)).toMatchObject({ status: "DONE", returnedQty: 2, destroyedQty: 2 });
    await expect(acknowledgeRecall(atl, notice.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listRecalls(kebab)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // the recalled lot can't be sold again: 24 of the good lot are free (14 more of the recalled one would have been)
    await expect(buy(LX, src.id, 30)).rejects.toThrow();
    await closeRecall(atl, r.id, "all collected");
    expect((await getRecall(sa, r.id, "en")).status).toBe("CLOSED");
    await expect(reportRecallAction(kebab, notice.id, { returnedQty: 2, destroyedQty: 0, noneLeft: false })).rejects.toThrow(/closed/);
    await clearCart(lx);
    await cancelPickList(lx, pick);
  });
});

describe("FIRINGI switches the warehouse features per supplier", () => {
  afterAll(async () => { await resetWarehouseFeatures(await ctxFor(SA), lx.company.id).catch(() => null); });

  it("everything is on until FIRINGI switches a feature off for one supplier", async () => {
    const sa = await ctxFor(SA), fin = await ctxFor(FIN), atl = await ctxFor(ATL);
    await resetWarehouseFeatures(sa, lx.company.id);
    expect(await warehouseFeatures(lx.company.id)).toEqual({ pickPack: true, bins: true, traceability: true, recalls: true });
    await expect(setWarehouseFeature(fin, lx.company.id, "BINS", false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setWarehouseFeature(lx, lx.company.id, "BINS", false)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await setWarehouseFeature(sa, lx.company.id, "BINS", false);
    await setWarehouseFeature(sa, lx.company.id, "TRACE", false);
    await setWarehouseFeature(sa, lx.company.id, "RECALLS", false);
    expect((await supplierWarehouseFeatures(sa)).find((s) => s.id === lx.company.id)).toMatchObject({ custom: true, features: { pickPack: true, bins: false, traceability: false, recalls: false } });
    // refused for that supplier only
    await expect(createBin(lx, { addressId: lisboa, code: "OFF-1" })).rejects.toMatchObject({ code: "FEATURE_OFF" });
    await expect(listBins(lx, lisboa)).resolves.toBeDefined(); // pick lists still read shelf codes while pick & pack is on
    await expect(traceLot(lx, { offerId, lotCode: "X" }, "pt-PT")).rejects.toMatchObject({ code: "FEATURE_OFF" });
    await expect(startRecall(lx, { offerId, lotCode: "X", recallClass: "CLASS_III", reason: "test reason" })).rejects.toMatchObject({ code: "FEATURE_OFF" });
    expect(await featureOn(atl, "BINS")).toBe(true); // another supplier keeps everything
    expect(await featureOn(sa, "RECALLS")).toBe(true); // FIRINGI is never limited
    // the menu hides what is off; recalls stay listed (history, recalls started by FIRINGI)
    const nav = resolveNav(VENDOR_NAV, lx.permissions, "en", {}, await hiddenWarehouseNav(lx));
    const wh = nav.find((x) => x.key === "warehouse")!.items.map((i) => i.href);
    expect(wh).toEqual(["/vendor/warehouse/pick", "/vendor/warehouse/scan", "/vendor/warehouse/recalls"]);
    // pick & pack off too → the scanner keeps working only while one of them is on
    await setWarehouseFeature(sa, lx.company.id, "PICK_PACK", false);
    await expect(pickLists(lx)).rejects.toMatchObject({ code: "FEATURE_OFF" });
    await expect(resolveScan(lx, "A-01-1", "pt-PT")).rejects.toMatchObject({ code: "FEATURE_OFF" });
    // back to all on
    await resetWarehouseFeatures(sa, lx.company.id);
    expect(await featureOn(lx, "BINS", "PICK_PACK", "TRACE", "RECALLS")).toBe(true);
    expect((await listBins(lx, lisboa)).length).toBeGreaterThan(0);
  });
});
