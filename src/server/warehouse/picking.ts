/**
 * Pick & pack (Phase 25).
 *
 * A pick list is made from the reservations the chosen orders already hold in one warehouse — so it
 * follows FEFO/FIFO exactly as stock was reserved — and is sorted in shelf walking order. Every line
 * is confirmed by scanning (the lot's FIRINGI label, its lot number, or the product barcode when the
 * lot has no number) or, when there is nothing to scan, by hand (recorded as such).
 *
 * Short pick: the picker says how many were really on the shelf. The rest of that lot is counted
 * out of stock there (a COUNT movement), the order's reservation is moved to other lots when there
 * are any (new lines are added to the list) and, if not, FIRINGI gets a STOCK_SHORT exception on the
 * order. Packing records the boxes, prints the packing slip and box labels and marks the order ready
 * for pickup.
 */
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { nextNumber, changeOrderStatus } from "@/server/services/orders";
import { batchFamily, issue, releaseBatch, releaseForOrder, reserveForOrder, reservedFor } from "@/server/inventory/ledger";
import { ownWarehouse, requireInventory, warehouses } from "@/server/inventory/service";
import { pickLocalized } from "@/i18n/config";
import { PICK, SEE, sortKey } from "./bins";
import { parseScan } from "./scan";

const ACTIVE = ["OPEN", "PICKED"] as const;
const name = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;

/** Accepted orders with goods reserved in this warehouse that are on no open pick list. */
export async function pickableOrders(ctx: Ctx, addressId: string) {
  requireInventory(ctx, [...PICK]);
  await ownWarehouse(ctx, addressId);
  const orders = await prisma.order.findMany({
    where: { sellerCompanyId: ctx.company.id, status: "SUPPLIER_PROCESSING", pickLists: { none: { pickList: { status: { in: [...ACTIVE] } } } } },
    select: { id: true, number: true, placedAt: true, requestedDeliveryDate: true, buyer: { select: { legalName: true, tradeName: true } }, deliveryAddress: true, _count: { select: { lines: true } } },
    orderBy: [{ requestedDeliveryDate: { sort: "asc", nulls: "last" } }, { placedAt: "asc" }],
    take: 200,
  });
  const out = [];
  for (const o of orders) {
    const held = (await reservedFor(prisma, o.id)).filter((r) => r.addressId === addressId);
    const units = held.reduce((a, r) => a + r.qty, 0);
    if (units > 0) out.push({ id: o.id, number: o.number, buyer: name(o.buyer), city: (o.deliveryAddress as { city?: string } | null)?.city ?? "", placedAt: o.placedAt, requestedDeliveryDate: o.requestedDeliveryDate, lines: o._count.lines, units });
  }
  return out;
}

async function batchInfo(tx: Tx, batchId: string | null) {
  if (!batchId) return null;
  return tx.stockBatch.findUnique({ where: { id: batchId }, select: { id: true, lotCode: true, expiresOn: true, bin: { select: { code: true, sortOrder: true } } } });
}

/** Lines for what an order still holds in the warehouse (minus what is already on the list). */
async function addLines(tx: Tx, pickListId: string, orderId: string, addressId: string, only?: { batchId: string; qty: number }[]) {
  const held = only ?? (await reservedFor(tx, orderId)).filter((r) => r.addressId === addressId).map((r) => ({ batchId: r.batchId!, qty: r.qty, offerId: r.offerId }));
  let n = 0;
  for (const h of held) {
    const b = await batchInfo(tx, h.batchId);
    const offerId = "offerId" in h && h.offerId ? (h.offerId as string) : (await tx.stockBatch.findUniqueOrThrow({ where: { id: h.batchId }, select: { offerId: true } })).offerId;
    await tx.pickLine.create({ data: { pickListId, orderId, offerId, batchId: h.batchId ?? null, binCode: b?.bin?.code ?? null, lotCode: b?.lotCode ?? null, expiresOn: b?.expiresOn ?? null, qty: h.qty, sortKey: sortKey(b?.bin ?? null) } });
    n++;
  }
  return n;
}

export async function createPickList(ctx: Ctx, i: { addressId: string; orderIds: string[]; note?: string | null }) {
  requireInventory(ctx, [...PICK]);
  await ownWarehouse(ctx, i.addressId);
  if (!i.orderIds.length) throw new ValidationError("Choose at least one order.");
  if (i.orderIds.length > 50) throw new ValidationError("At most 50 orders on one pick list.");
  const id = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where: { id: { in: i.orderIds }, sellerCompanyId: ctx.company.id }, select: { id: true, number: true, status: true, pickLists: { where: { pickList: { status: { in: [...ACTIVE] } } }, select: { pickListId: true } } } });
    if (orders.length !== i.orderIds.length) throw new NotFoundError("Order");
    for (const o of orders) {
      if (o.status !== "SUPPLIER_PROCESSING") throw new ValidationError(`${o.number} is not accepted / waiting to be prepared.`);
      if (o.pickLists.length) throw new ValidationError(`${o.number} is already on an open pick list.`);
    }
    const pl = await tx.pickList.create({ data: { companyId: ctx.company.id, addressId: i.addressId, number: await nextNumber(tx, "picklist", "PL"), note: i.note?.trim() || null, createdById: ctx.user.id } });
    let lines = 0;
    for (const o of orders) {
      await tx.pickListOrder.create({ data: { pickListId: pl.id, orderId: o.id } });
      lines += await addLines(tx, pl.id, o.id, i.addressId);
    }
    if (!lines) throw new ValidationError("Nothing of these orders is reserved in this warehouse.");
    return pl.id;
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.pick_list_created", entityType: "PickList", entityId: id, after: { orders: i.orderIds.length } });
  return id;
}

export async function pickLists(ctx: Ctx, status?: string) {
  requireInventory(ctx, [...SEE]);
  const rows = await prisma.pickList.findMany({
    where: { companyId: ctx.company.id, ...(status ? { status: status as "OPEN" } : {}) },
    include: { address: { select: { label: true } }, lines: { select: { qty: true, pickedQty: true, shortReason: true } }, _count: { select: { orders: true } } },
    orderBy: { createdAt: "desc" }, take: 200,
  });
  return rows.map((p) => ({
    id: p.id, number: p.number, status: p.status, warehouse: p.address.label, createdAt: p.createdAt, orders: p._count.orders,
    lines: p.lines.length, done: p.lines.filter((l) => l.pickedQty >= l.qty || l.shortReason).length,
    units: p.lines.reduce((a, l) => a + l.qty, 0), picked: p.lines.reduce((a, l) => a + l.pickedQty, 0), short: p.lines.filter((l) => l.shortReason).length,
  }));
}

async function ownList(ctx: Ctx, id: string) {
  const p = await prisma.pickList.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!p) throw new NotFoundError("Pick list");
  return p;
}

export async function getPickList(ctx: Ctx, id: string, locale: string) {
  requireInventory(ctx, [...SEE]);
  const p = await prisma.pickList.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      address: { select: { label: true } },
      orders: { include: { order: { select: { id: true, number: true, status: true, deliveryAddress: true, requestedDeliveryDate: true, buyer: { select: { legalName: true, tradeName: true } } } } } },
      lines: { orderBy: [{ sortKey: "asc" }, { expiresOn: { sort: "asc", nulls: "last" } }] },
    },
  });
  if (!p) throw new NotFoundError("Pick list");
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(p.lines.map((l) => l.offerId))] } }, select: { id: true, vendorSku: true, packaging: { select: { name: true, gtin: true, variant: { select: { gtin: true, product: { select: { name: true } } } } } } } });
  const batches = await prisma.stockBatch.findMany({ where: { id: { in: p.lines.map((l) => l.batchId).filter((x): x is string => !!x) } }, select: { id: true, blockedAt: true, bin: { select: { code: true } } } });
  const orderNo = new Map(p.orders.map((o) => [o.orderId, o.order.number]));
  const lines = p.lines.map((l) => {
    const o = offers.find((x) => x.id === l.offerId);
    const b = batches.find((x) => x.id === l.batchId);
    return {
      id: l.id, orderId: l.orderId, orderNumber: orderNo.get(l.orderId) ?? "", offerId: l.offerId, sku: o?.vendorSku ?? null,
      product: o ? pickLocalized(o.packaging.variant.product.name, locale) : "", packaging: o ? pickLocalized(o.packaging.name, locale) : "", gtin: o?.packaging.gtin ?? o?.packaging.variant.gtin ?? null,
      batchId: l.batchId, lotCode: l.lotCode, expiresOn: l.expiresOn, bin: b?.bin?.code ?? l.binCode, qty: l.qty, pickedQty: l.pickedQty, shortReason: l.shortReason, verified: l.verified,
      done: l.pickedQty >= l.qty || !!l.shortReason, blocked: !!b?.blockedAt,
    };
  });
  return {
    id: p.id, number: p.number, status: p.status, note: p.note, warehouse: p.address.label, addressId: p.addressId, createdAt: p.createdAt, pickedAt: p.pickedAt, packedAt: p.packedAt,
    orders: p.orders.map((o) => {
      const mine = lines.filter((l) => l.orderId === o.orderId);
      return {
        id: o.orderId, number: o.order.number, status: o.order.status, buyer: name(o.order.buyer), address: o.order.deliveryAddress as Record<string, string | null>,
        requestedDeliveryDate: o.order.requestedDeliveryDate, boxes: o.boxes, packedAt: o.packedAt,
        lines: mine.length, done: mine.every((l) => l.done), units: mine.reduce((a, l) => a + l.pickedQty, 0), short: mine.filter((l) => l.shortReason).length,
        canPack: !o.packedAt && o.order.status === "SUPPLIER_PROCESSING" && mine.length > 0 && mine.every((l) => l.done),
      };
    }),
    lines,
  };
}

async function finishIfDone(tx: Tx, ctx: Ctx, pickListId: string) {
  const lines = await tx.pickLine.findMany({ where: { pickListId }, select: { qty: true, pickedQty: true, shortReason: true } });
  if (lines.every((l) => l.pickedQty >= l.qty || l.shortReason)) await tx.pickList.updateMany({ where: { id: pickListId, status: "OPEN" }, data: { status: "PICKED", pickedAt: new Date(), pickedById: ctx.user.id } });
}

async function openLine(ctx: Ctx, lineId: string) {
  const line = await prisma.pickLine.findFirst({ where: { id: lineId, pickList: { companyId: ctx.company.id } }, include: { pickList: true } });
  if (!line) throw new NotFoundError("Pick line");
  if (line.pickList.status !== "OPEN") throw new ValidationError("This pick list is closed.");
  return line;
}

export type ScanOutcome = "OK" | "DONE" | "WRONG_LOT" | "WRONG_ITEM" | "LOT_NEEDED" | "SHELF" | "BLOCKED";

/**
 * Confirm a pick by scanning. Returns what the scan was (a wrong scan changes nothing):
 * OK (counted), DONE (line already complete), WRONG_LOT (right product, other lot),
 * WRONG_ITEM, LOT_NEEDED (product barcode scanned but this lot has a number), SHELF (a shelf
 * label), BLOCKED (recalled lot).
 */
export async function scanPick(ctx: Ctx, lineId: string, code: string, qty = 1): Promise<{ outcome: ScanOutcome; picked: number; qty: number }> {
  requireInventory(ctx, [...PICK]);
  const line = await openLine(ctx, lineId);
  const res = (outcome: ScanOutcome) => ({ outcome, picked: line.pickedQty, qty: line.qty });
  if (line.pickedQty >= line.qty || line.shortReason) return res("DONE");
  const p = parseScan(code);
  let ok = false;
  if (p.kind === "BIN") return res("SHELF");
  if (p.kind === "BATCH") {
    const b = await prisma.stockBatch.findFirst({ where: { id: p.id, offer: { vendorCompanyId: ctx.company.id } }, select: { id: true, offerId: true, blockedAt: true } });
    if (!b) return res("WRONG_ITEM");
    if (b.blockedAt) return res("BLOCKED");
    if (line.batchId && (await batchFamily(prisma, [line.batchId])).includes(b.id)) ok = true;
    else if (!line.batchId && b.offerId === line.offerId) ok = true;
    else return res(b.offerId === line.offerId ? "WRONG_LOT" : "WRONG_ITEM");
  } else if (p.kind === "TEXT") {
    const t = p.text.trim();
    if (line.lotCode && t.toLowerCase() === line.lotCode.toLowerCase()) ok = true;
    else {
      const offer = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: line.offerId }, select: { packaging: { select: { gtin: true, variant: { select: { gtin: true } } } } } });
      const gt = [offer.packaging.gtin, offer.packaging.variant.gtin].filter(Boolean);
      if (gt.includes(t)) {
        if (line.lotCode) return res("LOT_NEEDED");
        ok = true;
      } else {
        const other = await prisma.stockBatch.findFirst({ where: { offerId: line.offerId, lotCode: { equals: t, mode: "insensitive" } }, select: { id: true } });
        return res(other ? "WRONG_LOT" : "WRONG_ITEM");
      }
    }
  } else return res("WRONG_ITEM");
  if (!ok) return res("WRONG_ITEM");
  const add = Math.max(1, Math.min(Math.floor(qty), line.qty - line.pickedQty));
  const picked = line.pickedQty + add;
  await prisma.$transaction(async (tx) => {
    await tx.pickLine.update({ where: { id: line.id }, data: { pickedQty: picked, verified: "SCAN", pickedById: ctx.user.id, ...(picked >= line.qty ? { pickedAt: new Date() } : {}) } });
    await finishIfDone(tx, ctx, line.pickListId);
  });
  return { outcome: "OK", picked, qty: line.qty };
}

/** Confirm a pick by hand (no label to scan). Recorded as MANUAL. */
export async function confirmPick(ctx: Ctx, lineId: string, qty: number) {
  requireInventory(ctx, [...PICK]);
  const line = await openLine(ctx, lineId);
  if (!Number.isInteger(qty) || qty < 0 || qty > line.qty) throw new ValidationError(`Quantity must be between 0 and ${line.qty}.`);
  if (qty < line.qty) throw new ValidationError("Fewer than needed? Report it as short.");
  await prisma.$transaction(async (tx) => {
    await tx.pickLine.update({ where: { id: line.id }, data: { pickedQty: qty, verified: line.verified === "SCAN" ? "SCAN" : "MANUAL", pickedById: ctx.user.id, pickedAt: new Date() } });
    await finishIfDone(tx, ctx, line.pickListId);
  });
}

/** Fewer on the shelf than the list says (see header). */
export async function reportShort(ctx: Ctx, lineId: string, i: { found: number; reason: string }) {
  requireInventory(ctx, [...PICK]);
  const line = await openLine(ctx, lineId);
  if (line.shortReason || line.pickedQty >= line.qty) throw new ValidationError("This line is already done.");
  if (!Number.isInteger(i.found) || i.found < line.pickedQty || i.found >= line.qty) throw new ValidationError(`Found must be between ${line.pickedQty} and ${line.qty - 1}.`);
  const reason = i.reason.trim();
  if (!reason) throw new ValidationError("Please give a reason.");
  const missing = line.qty - i.found;
  const r = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: line.orderId }, select: { number: true } });
    await tx.pickLine.update({ where: { id: line.id }, data: { pickedQty: i.found, shortReason: reason, pickedById: ctx.user.id, pickedAt: new Date(), ...(i.found > line.pickedQty ? { verified: line.verified ?? "MANUAL" } : {}) } });
    let counted = 0;
    if (line.batchId) {
      await releaseBatch(tx, line.orderId, line.batchId, missing);
      // the shelf holds no more of this lot than was found: count the rest out
      const b = await tx.stockBatch.findUniqueOrThrow({ where: { id: line.batchId } });
      const free = b.onHand - b.reserved;
      if (free > 0 && !b.blockedAt) {
        await issue(tx, { offerId: b.offerId, addressId: b.addressId, qty: free, type: "COUNT", batchId: b.id, refType: "PICK", refId: line.pickListId, byUserId: ctx.user.id, note: `${line.pickList.number}: ${reason}` });
        counted = free;
      }
    } else await releaseForOrder(tx, line.orderId, { offerId: line.offerId, qty: missing });
    // cover the order from other lots when there are any
    let covered = 0;
    let res = await reserveForOrder(tx, line.orderId, line.offerId, missing);
    if (!res.ok && res.available > 0) res = await reserveForOrder(tx, line.orderId, line.offerId, res.available);
    if (res.ok) {
      covered = res.picks.reduce((a, p) => a + p.qty, 0);
      const here = res.picks.filter((p) => p.addressId === line.pickList.addressId);
      if (here.length) await addLines(tx, line.pickListId, line.orderId, line.pickList.addressId, here.map((p) => ({ batchId: p.batchId, qty: p.qty })));
      await tx.pickLine.update({ where: { id: line.id }, data: { coveredQty: covered } });
    }
    const still = missing - covered;
    if (still > 0) await tx.orderException.create({ data: { orderId: line.orderId, type: "STOCK_SHORT", description: `${line.pickList.number}: ${still} unit(s) not found when picking and no other stock — ${reason}` } });
    await finishIfDone(tx, ctx, line.pickListId);
    return { order: order.number, missing, covered, still, counted };
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.short_pick", entityType: "PickLine", entityId: line.id, after: r });
  return r;
}

/** Pack an order: boxes recorded, order marked ready for pickup. */
export async function packOrder(ctx: Ctx, i: { pickListId: string; orderId: string; boxes: number }) {
  requireInventory(ctx, [...PICK]);
  const list = await ownList(ctx, i.pickListId);
  if (list.status !== "OPEN" && list.status !== "PICKED") throw new ValidationError("This pick list is closed.");
  if (!Number.isInteger(i.boxes) || i.boxes < 1 || i.boxes > 999) throw new ValidationError("Boxes: 1–999.");
  const plo = await prisma.pickListOrder.findUnique({ where: { pickListId_orderId: { pickListId: list.id, orderId: i.orderId } }, include: { order: { select: { status: true, number: true } } } });
  if (!plo) throw new NotFoundError("Order");
  if (plo.packedAt) throw new ValidationError("Already packed.");
  const lines = await prisma.pickLine.findMany({ where: { pickListId: list.id, orderId: i.orderId } });
  if (!lines.length || lines.some((l) => l.pickedQty < l.qty && !l.shortReason)) throw new ValidationError("Pick every line of this order first.");
  if (plo.order.status === "SUPPLIER_PROCESSING") await changeOrderStatus(ctx, i.orderId, "READY_FOR_PICKUP", `Packed (${list.number}, ${i.boxes} box${i.boxes === 1 ? "" : "es"})`);
  else if (plo.order.status !== "READY_FOR_PICKUP") throw new ValidationError(`${plo.order.number} can't be packed now.`);
  await prisma.$transaction(async (tx) => {
    await tx.pickListOrder.update({ where: { pickListId_orderId: { pickListId: list.id, orderId: i.orderId } }, data: { boxes: i.boxes, packedAt: new Date() } });
    const all = await tx.pickListOrder.findMany({ where: { pickListId: list.id }, include: { order: { select: { status: true } } } });
    if (all.every((o) => o.packedAt || o.order.status === "CANCELLED")) await tx.pickList.update({ where: { id: list.id }, data: { status: "PACKED", packedAt: new Date(), packedById: ctx.user.id, ...(list.pickedAt ? {} : { pickedAt: new Date(), pickedById: ctx.user.id }) } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.packed", entityType: "Order", entityId: i.orderId, after: { pickList: list.number, boxes: i.boxes } });
}

export async function cancelPickList(ctx: Ctx, id: string) {
  requireInventory(ctx, [...PICK]);
  const list = await ownList(ctx, id);
  if (list.status === "PACKED" || list.status === "CANCELLED") throw new ValidationError("This pick list is closed.");
  if (await prisma.pickListOrder.count({ where: { pickListId: id, packedAt: { not: null } } })) throw new ValidationError("Some orders are already packed.");
  await prisma.pickList.update({ where: { id }, data: { status: "CANCELLED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.pick_list_cancelled", entityType: "PickList", entityId: id });
}

/** Unpicked lines of open lists that point at a lot that was just recalled: rebuilt from the new reservations. */
export async function refreshLinesAfterRecall(tx: Tx, blockedBatchIds: string[]) {
  if (!blockedBatchIds.length) return;
  const stale = await tx.pickLine.findMany({ where: { batchId: { in: blockedBatchIds }, pickList: { status: "OPEN" } }, include: { pickList: true } });
  for (const l of stale) {
    // already in the picker's hands: kept on the list as "recalled — put aside" (never packed); else dropped
    if (l.pickedQty > 0) await tx.pickLine.update({ where: { id: l.id }, data: { shortReason: "RECALLED" } });
    else await tx.pickLine.delete({ where: { id: l.id } });
  }
  const pairs = [...new Map(stale.map((l) => [`${l.pickListId}|${l.orderId}`, l])).values()];
  for (const l of pairs) {
    const onList = await tx.pickLine.findMany({ where: { pickListId: l.pickListId, orderId: l.orderId } });
    const held = (await reservedFor(tx, l.orderId)).filter((r) => r.addressId === l.pickList.addressId && r.batchId);
    const missing = held
      .map((h) => ({ batchId: h.batchId!, qty: h.qty - onList.filter((x) => x.batchId === h.batchId && x.shortReason !== "RECALLED").reduce((a, x) => a + x.qty, 0) }))
      .filter((h) => h.qty > 0);
    if (missing.length) await addLines(tx, l.pickListId, l.orderId, l.pickList.addressId, missing);
  }
}

export const warehouseOptions = (ctx: Ctx) => {
  requireInventory(ctx, [...SEE]);
  return warehouses(ctx);
};
