/**
 * Inventory ledger (Phase 24) — the one place stock changes.
 *
 * StockLevel is the offer × warehouse total that ordering and the catalogue read; StockBatch is the
 * detail underneath it (lot, best-before date, cost). Every function here keeps the two in step:
 *   Σ batch.onHand = level.onHand,  Σ batch.reserved = level.reserved
 * and writes one StockMovement per batch touched (with the average cost at that moment, so the
 * movement's value = qty × unitCost — cost of goods sold for shipments).
 *
 * Valuation is weighted average per offer × warehouse: a receipt at cost c of q units moves the
 * average to (onHand·avg + q·c) / (onHand + q); issues never change it.
 *
 * Batches are used in this order: when the supplier has FEFO on, the one that expires first
 * (no date last), otherwise the oldest receipt first. Expired or written-off batches are never
 * reserved for an order.
 *
 * `syncBatches` repairs a level whose batches drifted (stock written directly, e.g. by an old
 * import or a test): the difference goes to / comes from a batch without a lot number.
 */
import { Prisma, type StockMovementType, type BatchSource } from "@prisma/client";
import type { Tx } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { inventorySettings } from "./settings";
import { purchasedReturned } from "./purchased-core";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type Pick = { batchId: string; lotCode: string | null; expiresOn: Date | null; qty: number; unitCost: string };

type BatchRow = { id: string; lotCode: string | null; expiresOn: Date | null; onHand: number; reserved: number; unitCost: Dec; receivedAt: Date };

const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
export const isExpired = (expiresOn: Date | null | undefined, on = today()) => !!expiresOn && expiresOn.getTime() < on.getTime();

/** FEFO when the supplier has it on, else FIFO. */
async function pickOrderFor(tx: Tx, offerId: string): Promise<"FEFO" | "FIFO"> {
  const o = await tx.vendorOffer.findUniqueOrThrow({ where: { id: offerId }, select: { vendorCompanyId: true } });
  return (await inventorySettings(tx, o.vendorCompanyId)).fefo ? "FEFO" : "FIFO";
}

function sortBatches<T extends { expiresOn: Date | null; receivedAt: Date; id: string }>(rows: T[], order: "FEFO" | "FIFO") {
  return [...rows].sort((a, b) => {
    if (order === "FEFO") {
      const ea = a.expiresOn?.getTime() ?? Infinity, eb = b.expiresOn?.getTime() ?? Infinity;
      if (ea !== eb) return ea - eb;
    }
    return a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id);
  });
}

/** Lock (creating if needed) the level row of an offer in a warehouse. */
async function lockLevel(tx: Tx, offerId: string, addressId: string) {
  await tx.$executeRaw`INSERT INTO "StockLevel" ("id", "offerId", "addressId", "onHand", "reserved", "avgCost", "updatedAt")
    VALUES (${"sl" + cryptoId()}, ${offerId}, ${addressId}, 0, 0, 0, now()) ON CONFLICT ("offerId", "addressId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; onHand: number; reserved: number; avgCost: Dec }[]>`
    SELECT id, "onHand", reserved, "avgCost" FROM "StockLevel" WHERE "offerId" = ${offerId} AND "addressId" = ${addressId} FOR UPDATE`;
  const r = rows[0];
  return { id: r.id, onHand: Number(r.onHand), reserved: Number(r.reserved), avgCost: new D(r.avgCost.toString()) };
}
function cryptoId() {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 23);
}

async function liveBatches(tx: Tx, offerId: string, addressId: string): Promise<BatchRow[]> {
  return tx.stockBatch.findMany({
    where: { offerId, addressId, writtenOffAt: null, onHand: { gt: 0 } },
    select: { id: true, lotCode: true, expiresOn: true, onHand: true, reserved: true, unitCost: true, receivedAt: true },
  });
}

/** Make the batches add up to the level again (see header). Returns the locked level. */
export async function syncBatches(tx: Tx, offerId: string, addressId: string) {
  const level = await lockLevel(tx, offerId, addressId);
  const batches = await liveBatches(tx, offerId, addressId);
  const onHand = batches.reduce((a, b) => a + b.onHand, 0), reserved = batches.reduce((a, b) => a + b.reserved, 0);
  if (onHand === level.onHand && reserved === level.reserved) return level;
  const order = await pickOrderFor(tx, offerId);
  // on hand: add to / take from a batch without a lot (newest first when taking)
  if (onHand < level.onHand) {
    const loose = batches.find((b) => !b.lotCode && !b.expiresOn);
    if (loose) await tx.stockBatch.update({ where: { id: loose.id }, data: { onHand: { increment: level.onHand - onHand } } });
    else await tx.stockBatch.create({ data: { offerId, addressId, onHand: level.onHand - onHand, source: "OPENING", unitCost: level.avgCost } });
  } else if (onHand > level.onHand) {
    let extra = onHand - level.onHand;
    for (const b of sortBatches(batches, order).reverse()) {
      const take = Math.min(extra, b.onHand - b.reserved);
      if (take <= 0) continue;
      await tx.stockBatch.update({ where: { id: b.id }, data: { onHand: { decrement: take } } });
      extra -= take;
      if (!extra) break;
    }
  }
  // reserved: spread the level's reservation over the batches in pick order
  const fresh = sortBatches(await liveBatches(tx, offerId, addressId), order);
  let want = Math.min(level.reserved, fresh.reduce((a, b) => a + b.onHand, 0));
  for (const b of fresh) {
    const r = Math.min(want, b.onHand);
    if (r !== b.reserved) await tx.stockBatch.update({ where: { id: b.id }, data: { reserved: r } });
    want -= r;
  }
  return level;
}

async function move(tx: Tx, data: { offerId: string; addressId: string; type: StockMovementType; qty: number; batchId: string | null; unitCost: Dec; orderId?: string | null; note?: string | null; byUserId?: string | null; refType?: string | null; refId?: string | null }) {
  await tx.stockMovement.create({ data: { ...data, unitCost: data.unitCost.toDecimalPlaces(4) } });
}

// ───────────────────────────── orders ─────────────────────────────

/** Reserve qty of an offer for an order across the supplier's warehouses (most usable first). */
export async function reserveForOrder(tx: Tx, orderId: string, offerId: string, qty: number) {
  const levels = await tx.stockLevel.findMany({ where: { offerId, onHand: { gt: 0 } }, select: { addressId: true } });
  const order = await pickOrderFor(tx, offerId);
  const usable: { addressId: string; free: number; batches: BatchRow[] }[] = [];
  for (const l of levels) {
    await syncBatches(tx, offerId, l.addressId);
    const bs = sortBatches((await liveBatches(tx, offerId, l.addressId)).filter((b) => !isExpired(b.expiresOn) && b.onHand > b.reserved), order);
    const free = bs.reduce((a, b) => a + b.onHand - b.reserved, 0);
    if (free > 0) usable.push({ addressId: l.addressId, free, batches: bs });
  }
  usable.sort((a, b) => b.free - a.free);
  const available = usable.reduce((a, u) => a + u.free, 0);
  if (available < qty) return { ok: false as const, available };
  let left = qty;
  const used: string[] = [];
  for (const u of usable) {
    if (!left) break;
    const level = await lockLevel(tx, offerId, u.addressId);
    let here = 0;
    for (const b of u.batches) {
      if (!left) break;
      const take = Math.min(left, b.onHand - b.reserved);
      if (take <= 0) continue;
      await tx.stockBatch.update({ where: { id: b.id }, data: { reserved: { increment: take } } });
      await move(tx, { offerId, addressId: u.addressId, type: "RESERVE", qty: take, batchId: b.id, unitCost: level.avgCost, orderId });
      left -= take;
      here += take;
    }
    if (here) {
      await tx.stockLevel.update({ where: { id: level.id }, data: { reserved: { increment: here } } });
      used.push(u.addressId);
    }
  }
  return { ok: true as const, addressId: used[0] };
}

type Held = { offerId: string; addressId: string; batchId: string | null; qty: number };

/** What is still reserved for an order, per offer × warehouse × batch (from the movements). */
async function reservedFor(tx: Tx, orderId: string): Promise<Held[]> {
  const moves = await tx.stockMovement.findMany({ where: { orderId, type: { in: ["RESERVE", "RELEASE", "SHIPMENT"] } }, orderBy: { at: "asc" } });
  const map = new Map<string, Held>();
  for (const m of moves) {
    const k = `${m.offerId}|${m.addressId}|${m.batchId ?? ""}`;
    const cur = map.get(k) ?? { offerId: m.offerId, addressId: m.addressId, batchId: m.batchId, qty: 0 };
    cur.qty += m.type === "RESERVE" ? m.qty : -m.qty;
    map.set(k, cur);
  }
  return [...map.values()].filter((r) => r.qty > 0);
}

/** A batch that still holds reservation for this row (the recorded one, or any — legacy rows). */
async function batchHolding(tx: Tx, r: Held, need: "reserved" | "onHand") {
  if (r.batchId) {
    const b = await tx.stockBatch.findUnique({ where: { id: r.batchId } });
    if (b && b[need] > 0) return b;
  }
  const order = await pickOrderFor(tx, r.offerId);
  const bs = sortBatches(await liveBatches(tx, r.offerId, r.addressId), order).filter((b) => b[need] > 0);
  return bs.length ? tx.stockBatch.findUniqueOrThrow({ where: { id: bs[0].id } }) : null;
}

/** Release reserved stock of an order (all, or `qty` of one offer). */
export async function releaseForOrder(tx: Tx, orderId: string, only?: { offerId: string; qty: number }) {
  let left = only?.qty ?? Infinity;
  for (const r of await reservedFor(tx, orderId)) {
    if (only && r.offerId !== only.offerId) continue;
    let q = Math.min(r.qty, left);
    if (q <= 0) continue;
    const level = await syncBatches(tx, r.offerId, r.addressId);
    left -= q;
    await tx.stockLevel.update({ where: { id: level.id }, data: { reserved: { decrement: Math.min(q, level.reserved) } } });
    while (q > 0) {
      const b = await batchHolding(tx, r, "reserved");
      if (!b) break;
      const take = Math.min(q, b.reserved);
      await tx.stockBatch.update({ where: { id: b.id }, data: { reserved: { decrement: take } } });
      await move(tx, { offerId: r.offerId, addressId: r.addressId, type: "RELEASE", qty: take, batchId: b.id, unitCost: level.avgCost, orderId });
      q -= take;
      r.batchId = null; // anything left comes from other batches
    }
  }
}

/** Goods leave the warehouse: reserved → shipped. Records cost of goods at the average cost. */
export async function shipForOrder(tx: Tx, orderId: string) {
  for (const r of await reservedFor(tx, orderId)) {
    const level = await syncBatches(tx, r.offerId, r.addressId);
    await tx.stockLevel.update({ where: { id: level.id }, data: { reserved: { decrement: Math.min(r.qty, level.reserved) }, onHand: { decrement: Math.min(r.qty, level.onHand) } } });
    let q = r.qty;
    while (q > 0) {
      const b = await batchHolding(tx, r, "reserved");
      if (!b) break;
      const take = Math.min(q, b.reserved);
      await tx.stockBatch.update({ where: { id: b.id }, data: { reserved: { decrement: take }, onHand: { decrement: take } } });
      await move(tx, { offerId: r.offerId, addressId: r.addressId, type: "SHIPMENT", qty: take, batchId: b.id, unitCost: level.avgCost, orderId });
      q -= take;
      r.batchId = null;
    }
  }
}

/**
 * Goods that left come back (cancelled after dispatch, or a return): into the same batch when it
 * still exists, at the cost they left with. `only` limits it to some offers / quantities.
 */
export async function restockForOrder(tx: Tx, orderId: string, only?: Map<string, number>) {
  const moves = await tx.stockMovement.findMany({ where: { orderId, type: { in: ["SHIPMENT", "RETURN"] } }, orderBy: { at: "asc" } });
  const net = new Map<string, { offerId: string; addressId: string; batchId: string | null; qty: number; cost: Dec }>();
  for (const m of moves) {
    const k = `${m.offerId}|${m.addressId}|${m.batchId ?? ""}`;
    const cur = net.get(k) ?? { offerId: m.offerId, addressId: m.addressId, batchId: m.batchId, qty: 0, cost: new D(m.unitCost?.toString() ?? 0) };
    cur.qty += m.type === "SHIPMENT" ? m.qty : -m.qty;
    net.set(k, cur);
  }
  const left = only ? new Map(only) : null;
  for (const r of net.values()) {
    let q = r.qty;
    if (left) q = Math.min(q, left.get(r.offerId) ?? 0);
    if (q <= 0) continue;
    const level = await syncBatches(tx, r.offerId, r.addressId);
    const batch = r.batchId ? await tx.stockBatch.findUnique({ where: { id: r.batchId } }) : null;
    const batchId = batch && !batch.writtenOffAt
      ? (await tx.stockBatch.update({ where: { id: batch.id }, data: { onHand: { increment: q } } })).id
      : (await tx.stockBatch.create({ data: { offerId: r.offerId, addressId: r.addressId, onHand: q, source: "RETURN", unitCost: r.cost, lotCode: batch?.lotCode ?? null, expiresOn: batch?.expiresOn ?? null, refId: orderId } })).id;
    const avg = weighted(level.onHand, level.avgCost, q, r.cost);
    await tx.stockLevel.update({ where: { id: level.id }, data: { onHand: { increment: q }, avgCost: avg } });
    await move(tx, { offerId: r.offerId, addressId: r.addressId, type: "RETURN", qty: q, batchId, unitCost: r.cost, orderId });
    if (r.batchId) await purchasedReturned(tx, orderId, r.offerId, r.batchId, q);
    if (left) left.set(r.offerId, (left.get(r.offerId) ?? 0) - q);
  }
}

// ───────────────────────────── warehouse ─────────────────────────────

export function weighted(onHand: number, avg: Dec, qty: number, cost: Dec) {
  if (onHand + qty <= 0) return cost.toDecimalPlaces(4);
  if (onHand <= 0 || avg.isZero()) return cost.toDecimalPlaces(4); // nothing valued yet: the new cost is the average
  return avg.mul(onHand).add(cost.mul(qty)).div(onHand + qty).toDecimalPlaces(4);
}

/** Batches holding goods bought on FIRINGI (kept apart: they carry the buyer's expiry alerts). */
async function firingiBatchIds(tx: Tx, offerId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT p."ownBatchId" AS id FROM "PurchasedLot" p JOIN "StockBatch" b ON b.id = p."ownBatchId" WHERE b."offerId" = ${offerId}`;
  return rows.map((r) => r.id);
}

export type ReceiveInput = {
  offerId: string; addressId: string; qty: number; unitCost: Dec | number | string | null;
  lotCode?: string | null; expiresOn?: Date | null; source: BatchSource; type?: StockMovementType;
  refType?: string | null; refId?: string | null; byUserId?: string | null; note?: string | null;
  /** always a batch of its own (goods bought on FIRINGI) */
  separate?: boolean;
};

/**
 * Goods come in. `unitCost` null = at the current average (stock found / set by hand: the average
 * doesn't move). Same lot + same best-before at the same place adds to that batch.
 */
export async function receive(tx: Tx, i: ReceiveInput) {
  if (!Number.isInteger(i.qty) || i.qty <= 0) throw new ValidationError("Quantity must be a whole number above 0.");
  const level = await syncBatches(tx, i.offerId, i.addressId);
  const cost = i.unitCost === null ? level.avgCost : new D(i.unitCost.toString());
  if (cost.isNegative()) throw new ValidationError("Cost can't be negative.");
  const lotCode = i.lotCode?.trim() || null;
  const same = lotCode || i.expiresOn
    // goods bought on FIRINGI always get their own batch, and nothing else joins one of them
    ? i.separate ? null : await tx.stockBatch.findFirst({ where: { offerId: i.offerId, addressId: i.addressId, lotCode, expiresOn: i.expiresOn ?? null, writtenOffAt: null, id: { notIn: await firingiBatchIds(tx, i.offerId) } } })
    : null;
  const batch = same
    ? await tx.stockBatch.update({ where: { id: same.id }, data: { onHand: { increment: i.qty }, unitCost: weighted(same.onHand, new D(same.unitCost.toString()), i.qty, cost) } })
    : await tx.stockBatch.create({ data: { offerId: i.offerId, addressId: i.addressId, lotCode, expiresOn: i.expiresOn ?? null, onHand: i.qty, unitCost: cost, source: i.source, refId: i.refId ?? null } });
  const avg = i.unitCost === null ? (level.avgCost.isZero() ? cost : level.avgCost) : weighted(level.onHand, level.avgCost, i.qty, cost);
  await tx.stockLevel.update({ where: { id: level.id }, data: { onHand: { increment: i.qty }, avgCost: avg } });
  await move(tx, { offerId: i.offerId, addressId: i.addressId, type: i.type ?? "RECEIPT", qty: i.qty, batchId: batch.id, unitCost: cost, refType: i.refType, refId: i.refId, byUserId: i.byUserId, note: i.note });
  return { batchId: batch.id, avgCost: avg };
}

export type IssueInput = {
  offerId: string; addressId: string; qty: number; type: StockMovementType; batchId?: string | null;
  refType?: string | null; refId?: string | null; byUserId?: string | null; note?: string | null;
  /** allow taking expired batches (write-off, transfer of everything) — default true */
  includeExpired?: boolean;
};

/** Goods go out without an order (adjustment, transfer, count, write-off). Never touches reserved stock. */
export async function issue(tx: Tx, i: IssueInput): Promise<Pick[]> {
  if (!Number.isInteger(i.qty) || i.qty <= 0) throw new ValidationError("Quantity must be a whole number above 0.");
  const level = await syncBatches(tx, i.offerId, i.addressId);
  const order = await pickOrderFor(tx, i.offerId);
  let bs = sortBatches(await liveBatches(tx, i.offerId, i.addressId), order).filter((b) => b.onHand > b.reserved);
  if (i.includeExpired === false) bs = bs.filter((b) => !isExpired(b.expiresOn));
  if (i.batchId) bs = bs.filter((b) => b.id === i.batchId);
  const free = bs.reduce((a, b) => a + b.onHand - b.reserved, 0);
  if (free < i.qty) throw new ValidationError(i.batchId ? `Only ${free} of this batch are free (the rest is reserved for orders).` : `Only ${free} are free here (the rest is reserved for orders).`);
  let left = i.qty;
  const picks: Pick[] = [];
  for (const b of bs) {
    if (!left) break;
    const take = Math.min(left, b.onHand - b.reserved);
    await tx.stockBatch.update({ where: { id: b.id }, data: { onHand: { decrement: take } } });
    await move(tx, { offerId: i.offerId, addressId: i.addressId, type: i.type, qty: i.type === "ADJUSTMENT" || i.type === "COUNT" ? -take : take, batchId: b.id, unitCost: level.avgCost, refType: i.refType, refId: i.refId, byUserId: i.byUserId, note: i.note });
    picks.push({ batchId: b.id, lotCode: b.lotCode, expiresOn: b.expiresOn, qty: take, unitCost: b.unitCost.toString() });
    left -= take;
  }
  await tx.stockLevel.update({ where: { id: level.id }, data: { onHand: { decrement: i.qty } } });
  return picks;
}

/** Set the physical on-hand quantity (by hand / import): the difference goes in or out. */
export async function setOnHand(tx: Tx, i: { offerId: string; addressId: string; onHand: number; byUserId?: string | null; note?: string | null }) {
  if (!Number.isInteger(i.onHand) || i.onHand < 0) throw new ValidationError("Stock must be a whole number ≥ 0.");
  const level = await syncBatches(tx, i.offerId, i.addressId);
  if (i.onHand < level.reserved) throw new ValidationError(`${level.reserved} units are reserved for open orders.`);
  const delta = i.onHand - level.onHand;
  if (delta > 0) await receive(tx, { offerId: i.offerId, addressId: i.addressId, qty: delta, unitCost: null, source: "OPENING", type: "ADJUSTMENT", byUserId: i.byUserId, note: i.note });
  else if (delta < 0) await issue(tx, { offerId: i.offerId, addressId: i.addressId, qty: -delta, type: "ADJUSTMENT", byUserId: i.byUserId, note: i.note });
  return delta;
}

/** Value of what is in stock (Σ onHand × average cost). */
export const valueOf = (onHand: number, avgCost: Dec | string | number) => new D(avgCost.toString()).mul(onHand).toDecimalPlaces(2);
