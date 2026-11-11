/**
 * Stock counts and transfers (Phase 24).
 *
 * Count: a snapshot of what the system expects per batch in one warehouse (all products, or a few —
 * a cycle count); people enter what they find (blind by default: they don't see the expected
 * number); submitted → approved. On approval only the difference counted − expected is posted
 * (so orders shipped meanwhile don't distort it), valued at the average cost. A variance above
 * BIG_VARIANCE € needs a second person (or a company owner) to approve.
 *
 * Transfer: stock moves between two warehouses of the same company. Sending takes the batches
 * (FEFO / FIFO, never reserved stock) out of the source; receiving books the same lots and dates in
 * at the destination at the cost they left with. Anything not received is reported as lost in
 * transit; cancelling while in transit puts everything back at the source.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/orders";
import { issue, receive, syncBatches, type Pick } from "./ledger";
import { ownOffer, ownWarehouse, requireInventory } from "./service";

const D = Prisma.Decimal;
const MANAGE = "vendor.inventory.manage" as const;
const SEE = ["vendor.inventory.view", "vendor.inventory.manage"] as const;
export const BIG_VARIANCE = 250;

// ───────────────────────────── counts ─────────────────────────────

export async function startCount(ctx: Ctx, i: { addressId: string; kind: "FULL" | "CYCLE"; offerIds?: string[]; blind?: boolean; note?: string | null }) {
  requireInventory(ctx, MANAGE);
  await ownWarehouse(ctx, i.addressId);
  if (i.kind !== "FULL" && i.kind !== "CYCLE") throw new ValidationError("Choose a full or a cycle count.");
  if (i.kind === "CYCLE" && !i.offerIds?.length) throw new ValidationError("Choose the products to count.");
  const open = await prisma.stockCount.findFirst({ where: { ownerCompanyId: ctx.company.id, addressId: i.addressId, status: { in: ["OPEN", "SUBMITTED"] } } });
  if (open) throw new ValidationError(`Count ${open.number} is still open for this warehouse — finish it first.`);
  for (const id of i.offerIds ?? []) await ownOffer(ctx, id);
  return prisma.$transaction(async (tx) => {
    const levels = await tx.stockLevel.findMany({
      where: { addressId: i.addressId, offer: { vendorCompanyId: ctx.company.id, status: { not: "ARCHIVED" } }, ...(i.kind === "CYCLE" ? { offerId: { in: i.offerIds } } : { OR: [{ onHand: { gt: 0 } }, { reorderPoint: { not: null } }] }) },
    });
    const ids = new Set(levels.map((l) => l.offerId));
    for (const id of i.offerIds ?? []) if (!ids.has(id)) levels.push(await tx.stockLevel.upsert({ where: { offerId_addressId: { offerId: id, addressId: i.addressId } }, update: {}, create: { offerId: id, addressId: i.addressId } }));
    if (!levels.length) throw new ValidationError("Nothing to count in this warehouse.");
    const lines: Prisma.StockCountLineCreateWithoutCountInput[] = [];
    for (const l of levels) {
      await syncBatches(tx, l.offerId, i.addressId);
      const bs = await tx.stockBatch.findMany({ where: { offerId: l.offerId, addressId: i.addressId, writtenOffAt: null, onHand: { gt: 0 } }, orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }] });
      if (!bs.length) lines.push({ offer: { connect: { id: l.offerId } }, batchId: null, expectedQty: 0, unitCost: l.avgCost });
      for (const b of bs) lines.push({ offer: { connect: { id: l.offerId } }, batchId: b.id, expectedQty: b.onHand, unitCost: l.avgCost });
    }
    const number = await nextNumber(tx, "stock-count", "SC");
    const c = await tx.stockCount.create({ data: { ownerCompanyId: ctx.company.id, addressId: i.addressId, number, kind: i.kind, blind: i.blind ?? true, note: i.note?.trim() || null, createdById: ctx.user.id, lines: { create: lines } } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "stock_count.started", entityType: "StockCount", entityId: c.id, after: { number, kind: i.kind, lines: lines.length } }, tx);
    return c;
  });
}

export async function listCounts(ctx: Ctx) {
  requireInventory(ctx, [...SEE]);
  const rows = await prisma.stockCount.findMany({ where: { ownerCompanyId: ctx.company.id }, include: { address: { select: { label: true } }, _count: { select: { lines: true } }, lines: { select: { countedQty: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((c) => ({ id: c.id, number: c.number, kind: c.kind, status: c.status, warehouse: c.address.label, createdAt: c.createdAt, lines: c._count.lines, counted: c.lines.filter((l) => l.countedQty !== null).length, varianceQty: c.varianceQty, varianceValue: c.varianceValue?.toString() ?? null }));
}

export async function getCount(ctx: Ctx, id: string) {
  requireInventory(ctx, [...SEE]);
  const c = await prisma.stockCount.findFirst({
    where: { id, ownerCompanyId: ctx.company.id },
    include: { address: { select: { label: true } }, lines: { include: { offer: { select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } } } } },
  });
  if (!c) throw new NotFoundError("Stock count");
  const batches = await prisma.stockBatch.findMany({ where: { id: { in: c.lines.map((l) => l.batchId).filter((x): x is string => !!x) } }, select: { id: true, lotCode: true, expiresOn: true } });
  const users = await prisma.user.findMany({ where: { id: { in: [c.createdById, c.submittedById, c.approvedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nm = (u: string | null) => users.find((x) => x.id === u)?.name ?? null;
  const hideExpected = c.blind && c.status === "OPEN";
  const lines = c.lines
    .map((l) => {
      const b = batches.find((x) => x.id === l.batchId);
      const variance = l.countedQty === null ? null : l.countedQty - l.expectedQty;
      return {
        id: l.id, offerId: l.offerId, sku: l.offer.vendorSku, product: l.offer.packaging.variant.product.name, packaging: l.offer.packaging.name,
        lotCode: b?.lotCode ?? null, expiresOn: b?.expiresOn ?? null, expectedQty: hideExpected ? null : l.expectedQty, countedQty: l.countedQty,
        variance: hideExpected ? null : variance, varianceValue: hideExpected || variance === null ? null : l.unitCost.mul(variance).toFixed(2),
      };
    })
    .sort((a, b) => String(a.sku ?? "").localeCompare(String(b.sku ?? "")));
  const big = Math.abs(Number(c.varianceValue ?? 0)) >= BIG_VARIANCE;
  return {
    ...c, warehouse: c.address.label, lines, createdBy: nm(c.createdById), submittedBy: nm(c.submittedById), approvedBy: nm(c.approvedById),
    canCount: c.status === "OPEN" && can(ctx, MANAGE),
    canApprove: c.status === "SUBMITTED" && can(ctx, MANAGE) && (!big || c.submittedById !== ctx.user.id || ctx.membership.isOwner),
    needsSecondPerson: c.status === "SUBMITTED" && big && c.submittedById === ctx.user.id && !ctx.membership.isOwner,
  };
}

async function ownCount(ctx: Ctx, id: string) {
  const c = await prisma.stockCount.findFirst({ where: { id, ownerCompanyId: ctx.company.id } });
  if (!c) throw new NotFoundError("Stock count");
  return c;
}

/** Enter counted quantities (any number of times while open). */
export async function recordCount(ctx: Ctx, id: string, entries: { lineId: string; countedQty: number | null }[]) {
  requireInventory(ctx, MANAGE);
  const c = await ownCount(ctx, id);
  if (c.status !== "OPEN") throw new ValidationError("This count is no longer open.");
  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      if (e.countedQty !== null && (!Number.isInteger(e.countedQty) || e.countedQty < 0)) throw new ValidationError("Counted quantities must be whole numbers ≥ 0.");
      const r = await tx.stockCountLine.updateMany({ where: { id: e.lineId, countId: c.id }, data: { countedQty: e.countedQty } });
      if (!r.count) throw new ValidationError("Unknown line.");
    }
  });
}

/** Something found that wasn't expected (a product or lot not in the list). */
export async function addFoundLine(ctx: Ctx, id: string, i: { offerId: string; countedQty: number }) {
  requireInventory(ctx, MANAGE);
  const c = await ownCount(ctx, id);
  if (c.status !== "OPEN") throw new ValidationError("This count is no longer open.");
  await ownOffer(ctx, i.offerId);
  if (!Number.isInteger(i.countedQty) || i.countedQty < 1) throw new ValidationError("Counted quantity must be a whole number ≥ 1.");
  const l = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: i.offerId, addressId: c.addressId } } });
  return prisma.stockCountLine.create({ data: { countId: c.id, offerId: i.offerId, batchId: null, expectedQty: 0, countedQty: i.countedQty, unitCost: l?.avgCost ?? 0 } });
}

export async function submitCount(ctx: Ctx, id: string) {
  requireInventory(ctx, MANAGE);
  const c = await ownCount(ctx, id);
  if (c.status !== "OPEN") throw new ValidationError("This count is no longer open.");
  const lines = await prisma.stockCountLine.findMany({ where: { countId: c.id } });
  const missing = lines.filter((l) => l.countedQty === null).length;
  if (missing) throw new ValidationError(`${missing} line(s) not counted yet — enter 0 for what isn't there.`);
  const qty = lines.reduce((a, l) => a + (l.countedQty! - l.expectedQty), 0);
  const value = lines.reduce((a, l) => a.add(l.unitCost.mul(l.countedQty! - l.expectedQty)), new D(0)).toDecimalPlaces(2);
  await prisma.stockCount.update({ where: { id: c.id }, data: { status: "SUBMITTED", submittedById: ctx.user.id, submittedAt: new Date(), varianceQty: qty, varianceValue: value } });
}

/** Back to counting (e.g. a recount of some lines). */
export async function reopenCount(ctx: Ctx, id: string) {
  requireInventory(ctx, MANAGE);
  const c = await ownCount(ctx, id);
  if (c.status !== "SUBMITTED") throw new ValidationError("Only a submitted count can be reopened.");
  await prisma.stockCount.update({ where: { id: c.id }, data: { status: "OPEN", submittedById: null, submittedAt: null } });
}

export async function cancelCount(ctx: Ctx, id: string) {
  requireInventory(ctx, MANAGE);
  const c = await ownCount(ctx, id);
  if (c.status === "APPROVED" || c.status === "CANCELLED") throw new ValidationError("This count is closed.");
  await prisma.stockCount.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
}

/** Approve: post the differences (counted − expected) as COUNT movements. */
export async function approveCount(ctx: Ctx, id: string) {
  requireInventory(ctx, MANAGE);
  const view = await getCount(ctx, id);
  if (view.status !== "SUBMITTED") throw new ValidationError("Submit the count first.");
  if (view.needsSecondPerson) throw new ValidationError(`The difference is over ${BIG_VARIANCE} € — another person (or the owner) must approve it.`);
  const c = await ownCount(ctx, id);
  const lines = await prisma.stockCountLine.findMany({ where: { countId: c.id } });
  await prisma.$transaction(async (tx) => {
    for (const l of lines) {
      const delta = (l.countedQty ?? l.expectedQty) - l.expectedQty;
      if (!delta) continue;
      const batch = l.batchId ? await tx.stockBatch.findUnique({ where: { id: l.batchId } }) : null;
      if (delta > 0) {
        await receive(tx, { offerId: l.offerId, addressId: c.addressId, qty: delta, unitCost: null, lotCode: batch?.lotCode ?? null, expiresOn: batch?.expiresOn ?? null, source: "COUNT", type: "COUNT", refType: "COUNT", refId: c.id, byUserId: ctx.user.id, note: c.number });
      } else {
        const level = await syncBatches(tx, l.offerId, c.addressId);
        const free = batch && !batch.writtenOffAt ? batch.onHand - batch.reserved : 0;
        const fromBatch = Math.min(-delta, Math.max(0, free));
        if (fromBatch > 0) await issue(tx, { offerId: l.offerId, addressId: c.addressId, qty: fromBatch, type: "COUNT", batchId: batch!.id, refType: "COUNT", refId: c.id, byUserId: ctx.user.id, note: c.number });
        const rest = Math.min(-delta - fromBatch, Math.max(0, level.onHand - fromBatch - level.reserved));
        if (rest > 0) await issue(tx, { offerId: l.offerId, addressId: c.addressId, qty: rest, type: "COUNT", refType: "COUNT", refId: c.id, byUserId: ctx.user.id, note: c.number });
      }
    }
    await tx.stockCount.update({ where: { id: c.id }, data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "stock_count.approved", entityType: "StockCount", entityId: c.id, after: { number: c.number, varianceQty: c.varianceQty, varianceValue: c.varianceValue?.toString() } }, tx);
  });
}

// ───────────────────────────── transfers ─────────────────────────────

export async function createTransfer(ctx: Ctx, i: { fromAddressId: string; toAddressId: string; note?: string | null; lines: { offerId: string; qty: number }[] }) {
  requireInventory(ctx, MANAGE);
  if (i.fromAddressId === i.toAddressId) throw new ValidationError("Choose two different warehouses.");
  await ownWarehouse(ctx, i.fromAddressId);
  await ownWarehouse(ctx, i.toAddressId);
  if (!i.lines?.length) throw new ValidationError("Add at least one product.");
  const seen = new Set<string>();
  for (const l of i.lines) {
    await ownOffer(ctx, l.offerId);
    if (seen.has(l.offerId)) throw new ValidationError("A product is on the transfer twice — combine the lines.");
    seen.add(l.offerId);
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new ValidationError("Quantities must be whole numbers from 1.");
  }
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, "stock-transfer", "ST");
    return tx.stockTransfer.create({ data: { ownerCompanyId: ctx.company.id, number, fromAddressId: i.fromAddressId, toAddressId: i.toAddressId, note: i.note?.trim() || null, createdById: ctx.user.id, lines: { create: i.lines.map((l) => ({ offerId: l.offerId, qty: l.qty })) } } });
  });
}

export async function listTransfers(ctx: Ctx) {
  requireInventory(ctx, [...SEE]);
  const rows = await prisma.stockTransfer.findMany({ where: { ownerCompanyId: ctx.company.id }, include: { from: { select: { label: true } }, to: { select: { label: true } }, lines: { select: { qty: true, receivedQty: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((t) => ({ id: t.id, number: t.number, status: t.status, from: t.from.label, to: t.to.label, createdAt: t.createdAt, sentAt: t.sentAt, receivedAt: t.receivedAt, qty: t.lines.reduce((a, l) => a + l.qty, 0), received: t.lines.reduce((a, l) => a + (l.receivedQty ?? 0), 0) }));
}

export async function getTransfer(ctx: Ctx, id: string) {
  requireInventory(ctx, [...SEE]);
  const t = await prisma.stockTransfer.findFirst({
    where: { id, ownerCompanyId: ctx.company.id },
    include: { from: { select: { id: true, label: true } }, to: { select: { id: true, label: true } }, lines: { include: { offer: { select: { vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } } } } },
  });
  if (!t) throw new NotFoundError("Transfer");
  return {
    ...t,
    lines: t.lines.map((l) => ({ id: l.id, offerId: l.offerId, sku: l.offer.vendorSku, product: l.offer.packaging.variant.product.name, packaging: l.offer.packaging.name, qty: l.qty, receivedQty: l.receivedQty, unitCost: l.unitCost.toString(), picks: l.picks as unknown as Pick[] })),
    canSend: t.status === "DRAFT" && can(ctx, MANAGE), canReceive: t.status === "IN_TRANSIT" && can(ctx, MANAGE), canCancel: (t.status === "DRAFT" || t.status === "IN_TRANSIT") && can(ctx, MANAGE),
  };
}

async function ownTransfer(ctx: Ctx, id: string) {
  const t = await prisma.stockTransfer.findFirst({ where: { id, ownerCompanyId: ctx.company.id }, include: { lines: true } });
  if (!t) throw new NotFoundError("Transfer");
  return t;
}

export async function sendTransfer(ctx: Ctx, id: string) {
  requireInventory(ctx, MANAGE);
  const t = await ownTransfer(ctx, id);
  if (t.status !== "DRAFT") throw new ValidationError("This transfer was already sent.");
  await prisma.$transaction(async (tx) => {
    for (const l of t.lines) {
      const level = await syncBatches(tx, l.offerId, t.fromAddressId);
      const picks = await issue(tx, { offerId: l.offerId, addressId: t.fromAddressId, qty: l.qty, type: "TRANSFER_OUT", refType: "TRANSFER", refId: t.id, byUserId: ctx.user.id, note: t.number, includeExpired: false });
      await tx.stockTransferLine.update({ where: { id: l.id }, data: { unitCost: level.avgCost, picks: picks.map((p) => ({ ...p, expiresOn: p.expiresOn?.toISOString().slice(0, 10) ?? null })) } });
    }
    await tx.stockTransfer.update({ where: { id: t.id }, data: { status: "IN_TRANSIT", sentAt: new Date() } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "stock_transfer.sent", entityType: "StockTransfer", entityId: t.id, after: { number: t.number } }, tx);
  });
}

type StoredPick = { batchId?: string; lotCode: string | null; expiresOn: string | null; qty: number };

/** Book stock in at `addressId` from the picks (soonest-expiring first), up to `qty`. */
async function bookPicks(tx: Parameters<typeof receive>[0], ctx: Ctx, t: { id: string; number: string }, l: { offerId: string; unitCost: Prisma.Decimal; picks: Prisma.JsonValue }, addressId: string, qty: number, type: "TRANSFER_IN" | "RETURN") {
  let left = qty;
  for (const p of (l.picks as unknown as StoredPick[]) ?? []) {
    if (!left) break;
    const q = Math.min(left, p.qty);
    await receive(tx, { offerId: l.offerId, addressId, qty: q, unitCost: l.unitCost, splitFromId: p.batchId ?? null, lotCode: p.lotCode, expiresOn: p.expiresOn ? new Date(p.expiresOn) : null, source: "TRANSFER", type: type === "RETURN" ? "TRANSFER_IN" : type, refType: "TRANSFER", refId: t.id, byUserId: ctx.user.id, note: type === "RETURN" ? `${t.number} cancelled` : t.number });
    left -= q;
  }
}

/** Receive (all or part). Anything not received is recorded as lost in transit. */
export async function receiveTransfer(ctx: Ctx, id: string, received: { lineId: string; qty: number }[]) {
  requireInventory(ctx, MANAGE);
  const t = await ownTransfer(ctx, id);
  if (t.status !== "IN_TRANSIT") throw new ValidationError("This transfer isn't in transit.");
  await prisma.$transaction(async (tx) => {
    const lost: { offerId: string; qty: number; value: string }[] = [];
    for (const l of t.lines) {
      const r = received.find((x) => x.lineId === l.id);
      const qty = r ? r.qty : l.qty;
      if (!Number.isInteger(qty) || qty < 0 || qty > l.qty) throw new ValidationError(`Received quantity must be 0–${l.qty}.`);
      if (qty) await bookPicks(tx, ctx, t, l, t.toAddressId, qty, "TRANSFER_IN");
      if (qty < l.qty) lost.push({ offerId: l.offerId, qty: l.qty - qty, value: l.unitCost.mul(l.qty - qty).toFixed(2) });
      await tx.stockTransferLine.update({ where: { id: l.id }, data: { receivedQty: qty } });
    }
    await tx.stockTransfer.update({ where: { id: t.id }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "stock_transfer.received", entityType: "StockTransfer", entityId: t.id, after: { number: t.number, lostInTransit: lost } }, tx);
  });
}

export async function cancelTransfer(ctx: Ctx, id: string) {
  requireInventory(ctx, MANAGE);
  const t = await ownTransfer(ctx, id);
  if (t.status !== "DRAFT" && t.status !== "IN_TRANSIT") throw new ValidationError("This transfer is closed.");
  await prisma.$transaction(async (tx) => {
    if (t.status === "IN_TRANSIT") for (const l of t.lines) await bookPicks(tx, ctx, t, l, t.fromAddressId, l.qty, "RETURN");
    await tx.stockTransfer.update({ where: { id: t.id }, data: { status: "CANCELLED" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "stock_transfer.cancelled", entityType: "StockTransfer", entityId: t.id, after: { number: t.number, wasInTransit: t.status === "IN_TRANSIT" } }, tx);
  });
}
