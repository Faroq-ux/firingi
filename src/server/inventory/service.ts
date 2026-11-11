/**
 * Supplier inventory (Phase 24): what is in which warehouse, in which batches, what it is worth,
 * what to reorder — and the hand operations (receive, write off, reorder points, opening cost).
 * Works the same for FIRINGI's in-house warehouse (an in-house wholesaler).
 */
import { Prisma, type StockMovementType } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { isExpired, issue, receive, valueOf, weighted } from "./ledger";
import { inventorySettings, SHORT_DATED_DAYS } from "./settings";

const D = Prisma.Decimal;
export const VIEW: PermissionCode[] = ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage", "vendor.stock.manage"];

export function requireInventory(ctx: Ctx, perm: PermissionCode | PermissionCode[] = VIEW) {
  if (ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  if (ctx.company.status !== "APPROVED" || !can(ctx, perm)) throw new ForbiddenError();
}

export async function ownOffer(ctx: Ctx, offerId: string) {
  const o = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id } });
  if (!o) throw new NotFoundError("Product");
  return o;
}
export async function ownWarehouse(ctx: Ctx, addressId: string) {
  const a = await prisma.address.findFirst({ where: { id: addressId, companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  if (!a) throw new ValidationError("Choose one of your warehouse or pickup addresses.");
  return a;
}
export const warehouses = (ctx: Ctx) =>
  prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, orderBy: [{ kind: "asc" }, { label: "asc" }], select: { id: true, label: true, kind: true, cityName: true } });

const day = 86_400_000;
const todayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
export const daysLeft = (expiresOn: Date | null) => (expiresOn ? Math.round((expiresOn.getTime() - todayUtc().getTime()) / day) : null);

const OFFER_INCLUDE = { packaging: { select: { name: true, variant: { select: { product: { select: { name: true, category: { select: { name: true } } } } } } } } } as const;
export type OfferInfo = { id: string; sku: string | null; product: Prisma.JsonValue; packaging: Prisma.JsonValue; category: Prisma.JsonValue | null };
function offerInfo(o: { id: string; vendorSku: string | null; packaging: { name: Prisma.JsonValue; variant: { product: { name: Prisma.JsonValue; category: { name: Prisma.JsonValue } | null } } } }): OfferInfo {
  return { id: o.id, sku: o.vendorSku, product: o.packaging.variant.product.name, packaging: o.packaging.name, category: o.packaging.variant.product.category?.name ?? null };
}

export type StockStatus = "OK" | "LOW" | "OUT" | "EXPIRING" | "EXPIRED";

/**
 * One row per product × warehouse with stock or a reorder point: on hand, reserved, free, usable
 * (free minus expired), average cost, value, next best-before, incoming (open purchase orders),
 * status and the batches underneath.
 */
export async function stockOverview(ctx: Ctx, opts: { addressId?: string; q?: string } = {}) {
  requireInventory(ctx);
  const q = opts.q?.trim().toLowerCase();
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { not: "ARCHIVED" }, ...(q ? { OR: [{ vendorSku: { contains: q, mode: "insensitive" } }, { packaging: { variant: { product: { searchText: { contains: q } } } } }] } : {}) },
    select: { id: true, vendorSku: true, ...OFFER_INCLUDE },
  });
  const ids = offers.map((o) => o.id);
  const [levels, batches, incoming, wh] = await Promise.all([
    prisma.stockLevel.findMany({ where: { offerId: { in: ids }, ...(opts.addressId ? { addressId: opts.addressId } : {}) } }),
    prisma.stockBatch.findMany({ where: { offerId: { in: ids }, writtenOffAt: null, onHand: { gt: 0 }, ...(opts.addressId ? { addressId: opts.addressId } : {}) }, orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }] }),
    prisma.purchaseOrderLine.findMany({ where: { offerId: { in: ids }, po: { ownerCompanyId: ctx.company.id, status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, ...(opts.addressId ? { addressId: opts.addressId } : {}) } }, select: { offerId: true, qty: true, receivedQty: true, po: { select: { addressId: true } } } }),
    warehouses(ctx),
  ]);
  const byOffer = new Map(offers.map((o) => [o.id, offerInfo(o)]));
  const whName = new Map(wh.map((w) => [w.id, w.label]));
  return levels
    .filter((l) => l.onHand > 0 || l.reserved > 0 || l.reorderPoint !== null)
    .map((l) => {
      const bs = batches.filter((b) => b.offerId === l.offerId && b.addressId === l.addressId);
      const expired = bs.filter((b) => isExpired(b.expiresOn)).reduce((a, b) => a + b.onHand - b.reserved, 0);
      const free = Math.max(0, l.onHand - l.reserved);
      const usable = Math.max(0, free - expired);
      const next = bs.find((b) => b.expiresOn)?.expiresOn ?? null; // earliest, expired ones included
      const inc = incoming.filter((i) => i.offerId === l.offerId && i.po.addressId === l.addressId).reduce((a, i) => a + Math.max(0, i.qty - i.receivedQty), 0);
      const left = daysLeft(next);
      const status: StockStatus = expired > 0 ? "EXPIRED" : l.onHand <= 0 ? "OUT" : left !== null && left >= 0 && left <= SHORT_DATED_DAYS ? "EXPIRING" : l.reorderPoint !== null && usable <= l.reorderPoint ? "LOW" : "OK";
      return {
        offer: byOffer.get(l.offerId)!, addressId: l.addressId, warehouse: whName.get(l.addressId) ?? "—",
        onHand: l.onHand, reserved: l.reserved, free, usable, expired, incoming: inc,
        avgCost: l.avgCost.toString(), value: valueOf(l.onHand, l.avgCost).toString(),
        reorderPoint: l.reorderPoint, reorderQty: l.reorderQty, nextExpiry: next, daysLeft: left, status,
        batches: bs.map((b) => ({ id: b.id, lotCode: b.lotCode, expiresOn: b.expiresOn, daysLeft: daysLeft(b.expiresOn), onHand: b.onHand, reserved: b.reserved, unitCost: b.unitCost.toString(), source: b.source, receivedAt: b.receivedAt })),
      };
    })
    .filter((r) => byOffer.has(r.offer.id))
    .sort((a, b) => ({ EXPIRED: 0, OUT: 1, LOW: 2, EXPIRING: 3, OK: 4 })[a.status] - ({ EXPIRED: 0, OUT: 1, LOW: 2, EXPIRING: 3, OK: 4 })[b.status] || Number(b.value) - Number(a.value));
}

/** Headline numbers for the inventory dashboard. */
export async function inventorySummary(ctx: Ctx) {
  const rows = await stockOverview(ctx);
  const [openPos, openCounts, inTransit, settings] = await Promise.all([
    prisma.purchaseOrder.count({ where: { ownerCompanyId: ctx.company.id, status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } } }),
    prisma.stockCount.count({ where: { ownerCompanyId: ctx.company.id, status: { in: ["OPEN", "SUBMITTED"] } } }),
    prisma.stockTransfer.count({ where: { ownerCompanyId: ctx.company.id, status: "IN_TRANSIT" } }),
    inventorySettings(prisma, ctx.company.id),
  ]);
  const value = rows.reduce((a, r) => a.add(r.value), new D(0));
  return {
    value: value.toFixed(2), units: rows.reduce((a, r) => a + r.onHand, 0), lines: rows.length,
    low: rows.filter((r) => r.status === "LOW" || r.status === "OUT").length,
    expiring: rows.filter((r) => r.status === "EXPIRING").length, expired: rows.filter((r) => r.status === "EXPIRED").length,
    noCost: rows.filter((r) => r.onHand > 0 && Number(r.avgCost) === 0).length,
    openPos, openCounts, inTransit, settings,
  };
}

/** Batches that expire within `days` (or already expired), soonest first. */
export async function expiringBatches(ctx: Ctx, days = 30) {
  requireInventory(ctx);
  const until = new Date(todayUtc().getTime() + days * day);
  const rows = await prisma.stockBatch.findMany({
    where: { offer: { vendorCompanyId: ctx.company.id }, writtenOffAt: null, onHand: { gt: 0 }, expiresOn: { not: null, lte: until } },
    include: { offer: { select: { id: true, vendorSku: true, ...OFFER_INCLUDE } }, address: { select: { label: true } } },
    orderBy: { expiresOn: "asc" },
  });
  const levels = await prisma.stockLevel.findMany({ where: { offerId: { in: rows.map((r) => r.offerId) } }, select: { offerId: true, addressId: true, avgCost: true } });
  return rows.map((b) => {
    const avg = levels.find((l) => l.offerId === b.offerId && l.addressId === b.addressId)?.avgCost ?? new D(0);
    return { id: b.id, offer: offerInfo(b.offer), warehouse: b.address.label, addressId: b.addressId, lotCode: b.lotCode, expiresOn: b.expiresOn!, daysLeft: daysLeft(b.expiresOn)!, onHand: b.onHand, reserved: b.reserved, free: b.onHand - b.reserved, value: valueOf(b.onHand, avg).toString(), expired: isExpired(b.expiresOn) };
  });
}

const MOVE_TYPES: StockMovementType[] = ["RECEIPT", "ADJUSTMENT", "RESERVE", "RELEASE", "SHIPMENT", "RETURN", "TRANSFER_OUT", "TRANSFER_IN", "COUNT", "WRITE_OFF"];

/** The stock ledger: every movement, newest first (reservations hidden unless asked). */
export async function movements(ctx: Ctx, opts: { offerId?: string; addressId?: string; type?: string; withReservations?: boolean; take?: number } = {}) {
  requireInventory(ctx);
  const type = MOVE_TYPES.includes(opts.type as StockMovementType) ? (opts.type as StockMovementType) : undefined;
  const rows = await prisma.stockMovement.findMany({
    where: {
      offer: { vendorCompanyId: ctx.company.id },
      ...(opts.offerId ? { offerId: opts.offerId } : {}), ...(opts.addressId ? { addressId: opts.addressId } : {}),
      ...(type ? { type } : opts.withReservations ? {} : { type: { notIn: ["RESERVE", "RELEASE"] } }),
    },
    include: { offer: { select: { id: true, vendorSku: true, ...OFFER_INCLUDE } }, address: { select: { label: true } }, batch: { select: { lotCode: true, expiresOn: true } }, order: { select: { id: true, number: true } } },
    orderBy: { at: "desc" }, take: Math.min(opts.take ?? 300, 1000),
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.byUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const sign = (t: StockMovementType, q: number) => (["SHIPMENT", "TRANSFER_OUT", "WRITE_OFF", "RESERVE"].includes(t) ? -Math.abs(q) : t === "RELEASE" ? Math.abs(q) : q);
  return rows.map((m) => {
    const qty = sign(m.type, m.qty);
    return {
      id: m.id, at: m.at, type: m.type, qty, offer: offerInfo(m.offer), warehouse: m.address.label, lotCode: m.batch?.lotCode ?? null, expiresOn: m.batch?.expiresOn ?? null,
      unitCost: m.unitCost?.toString() ?? null, value: m.unitCost ? m.unitCost.mul(qty).toFixed(2) : null,
      order: m.order, refType: m.refType, refId: m.refId, note: m.note, by: users.find((u) => u.id === m.byUserId)?.name ?? null,
    };
  });
}

/** Goods in without a purchase order (lot, best-before and cost optional). */
export async function receiveStock(ctx: Ctx, i: { offerId: string; addressId: string; qty: number; unitCost?: number | null; lotCode?: string | null; expiresOn?: Date | null; note?: string | null }) {
  requireInventory(ctx, "vendor.inventory.manage");
  await ownOffer(ctx, i.offerId);
  await ownWarehouse(ctx, i.addressId);
  if (i.expiresOn && i.expiresOn.getTime() < todayUtc().getTime()) throw new ValidationError("That best-before date has already passed.");
  return prisma.$transaction(async (tx) => {
    const r = await receive(tx, { offerId: i.offerId, addressId: i.addressId, qty: i.qty, unitCost: i.unitCost ?? null, lotCode: i.lotCode, expiresOn: i.expiresOn ?? null, source: "RECEIPT", byUserId: ctx.user.id, note: i.note ?? null });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.received", entityType: "StockBatch", entityId: r.batchId, after: { ...i, expiresOn: i.expiresOn?.toISOString().slice(0, 10) ?? null } }, tx);
    return r;
  });
}

/** Take stock out of a batch (expired, damaged, lost). Written-off value is the average cost. */
export async function writeOff(ctx: Ctx, i: { batchId: string; qty?: number | null; reason: string }) {
  requireInventory(ctx, "vendor.inventory.manage");
  const reason = i.reason?.trim();
  if (!reason) throw new ValidationError("Say why the stock is written off.");
  const b = await prisma.stockBatch.findFirst({ where: { id: i.batchId, offer: { vendorCompanyId: ctx.company.id }, writtenOffAt: null } });
  if (!b) throw new NotFoundError("Batch");
  const qty = i.qty ?? b.onHand - b.reserved;
  if (qty <= 0) throw new ValidationError("Nothing free to write off in this batch — it is reserved for orders.");
  return prisma.$transaction(async (tx) => {
    const picks = await issue(tx, { offerId: b.offerId, addressId: b.addressId, qty, type: "WRITE_OFF", batchId: b.id, refType: "WRITE_OFF", byUserId: ctx.user.id, note: reason });
    const left = await tx.stockBatch.findUniqueOrThrow({ where: { id: b.id } });
    if (left.onHand === 0) await tx.stockBatch.update({ where: { id: b.id }, data: { writtenOffAt: new Date() } });
    const level = await tx.stockLevel.findUniqueOrThrow({ where: { offerId_addressId: { offerId: b.offerId, addressId: b.addressId } } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.written_off", entityType: "StockBatch", entityId: b.id, after: { qty, reason, lotCode: b.lotCode, expiresOn: b.expiresOn, value: valueOf(qty, level.avgCost).toString() } }, tx);
    return { qty, picks };
  });
}

/** Reorder point / quantity for a product in a warehouse (null = no reorder alert). */
export async function setReorder(ctx: Ctx, i: { offerId: string; addressId: string; reorderPoint: number | null; reorderQty: number | null }) {
  requireInventory(ctx, "vendor.inventory.manage");
  await ownOffer(ctx, i.offerId);
  await ownWarehouse(ctx, i.addressId);
  if (i.reorderPoint !== null && (!Number.isInteger(i.reorderPoint) || i.reorderPoint < 0)) throw new ValidationError("Reorder point must be a whole number ≥ 0.");
  if (i.reorderQty !== null && (!Number.isInteger(i.reorderQty) || i.reorderQty < 1)) throw new ValidationError("Reorder quantity must be a whole number ≥ 1.");
  if (i.reorderQty !== null && i.reorderPoint === null) throw new ValidationError("Set a reorder point first.");
  await prisma.stockLevel.upsert({
    where: { offerId_addressId: { offerId: i.offerId, addressId: i.addressId } },
    update: { reorderPoint: i.reorderPoint, reorderQty: i.reorderQty },
    create: { offerId: i.offerId, addressId: i.addressId, reorderPoint: i.reorderPoint, reorderQty: i.reorderQty },
  });
}

/**
 * Opening cost: only while no cost is known yet for that product in that warehouse (afterwards the
 * average moves with receipts). Logged.
 */
export async function setOpeningCost(ctx: Ctx, i: { offerId: string; addressId: string; unitCost: number }) {
  requireInventory(ctx, "vendor.inventory.manage");
  await ownOffer(ctx, i.offerId);
  if (!(i.unitCost >= 0) || !Number.isFinite(i.unitCost)) throw new ValidationError("Enter a cost ≥ 0.");
  const l = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: i.offerId, addressId: i.addressId } } });
  if (!l) throw new NotFoundError("Stock");
  if (!l.avgCost.isZero()) throw new ValidationError("This product already has a cost here — it changes with each receipt.");
  const cost = new D(i.unitCost).toDecimalPlaces(4);
  await prisma.$transaction(async (tx) => {
    await tx.stockLevel.update({ where: { id: l.id }, data: { avgCost: cost } });
    await tx.stockBatch.updateMany({ where: { offerId: i.offerId, addressId: i.addressId, unitCost: 0 }, data: { unitCost: cost } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "inventory.opening_cost", entityType: "StockLevel", entityId: l.id, after: { unitCost: cost.toString(), onHand: l.onHand } }, tx);
  });
}

/**
 * What to reorder: usable stock (free, not expired) + still incoming ≤ reorder point. Suggested
 * quantity = the reorder quantity, or enough to get back to twice the reorder point. Proposes the
 * supplier and cost of the last purchase order of that product.
 */
export async function reorderSuggestions(ctx: Ctx) {
  requireInventory(ctx);
  const rows = (await stockOverview(ctx)).filter((r) => r.reorderPoint !== null && r.usable + r.incoming <= r.reorderPoint);
  const last = await prisma.purchaseOrderLine.findMany({
    where: { offerId: { in: rows.map((r) => r.offer.id) }, po: { ownerCompanyId: ctx.company.id, status: { not: "CANCELLED" } } },
    select: { offerId: true, unitCost: true, sourceOfferId: true, po: { select: { supplierId: true, sellerCompanyId: true, createdAt: true, supplier: { select: { name: true } }, seller: { select: { legalName: true, tradeName: true } } } } },
    orderBy: { po: { createdAt: "desc" } },
  });
  return rows.map((r) => {
    const l = last.find((x) => x.offerId === r.offer.id);
    const qty = r.reorderQty ?? Math.max(1, r.reorderPoint! * 2 - r.usable - r.incoming);
    return {
      ...r, suggestedQty: qty,
      supplier: l ? (l.po.supplierId ? { kind: "OUTSIDE" as const, id: l.po.supplierId, name: l.po.supplier?.name ?? "—" } : { kind: "FIRINGI" as const, id: l.po.sellerCompanyId!, name: l.po.seller?.tradeName ?? l.po.seller?.legalName ?? "—", sourceOfferId: l.sourceOfferId }) : null,
      lastCost: l?.unitCost.toString() ?? (Number(r.avgCost) > 0 ? r.avgCost : null),
    };
  });
}

/**
 * Valuation: per product × warehouse value at average cost, per warehouse totals, and cost of goods
 * sold in a period (shipments − returns at the cost they left with).
 */
export async function valuation(ctx: Ctx, period: { from: Date; to: Date }) {
  requireInventory(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.reports.view"]);
  const rows = (await stockOverview(ctx)).filter((r) => r.onHand > 0);
  const byWarehouse = new Map<string, { warehouse: string; units: number; value: Prisma.Decimal; lines: number }>();
  for (const r of rows) {
    const w = byWarehouse.get(r.addressId) ?? { warehouse: r.warehouse, units: 0, value: new D(0), lines: 0 };
    w.units += r.onHand; w.value = w.value.add(r.value); w.lines++;
    byWarehouse.set(r.addressId, w);
  }
  const cogs = await prisma.$queryRaw<{ type: string; value: Prisma.Decimal | null; qty: bigint | null }[]>`
    SELECT m.type::text AS type, SUM(m.qty * COALESCE(m."unitCost", 0)) AS value, SUM(m.qty) AS qty
    FROM "StockMovement" m JOIN "VendorOffer" o ON o.id = m."offerId"
    WHERE o."vendorCompanyId" = ${ctx.company.id} AND m.at >= ${period.from} AND m.at < ${period.to} AND m.type IN ('SHIPMENT', 'RETURN', 'WRITE_OFF', 'RECEIPT')
    GROUP BY m.type`;
  const v = (t: string) => new D(cogs.find((c) => c.type === t)?.value?.toString() ?? 0);
  return {
    rows: rows.map((r) => ({ offer: r.offer, warehouse: r.warehouse, onHand: r.onHand, avgCost: r.avgCost, value: r.value })),
    warehouses: [...byWarehouse.values()].map((w) => ({ ...w, value: w.value.toFixed(2) })),
    total: rows.reduce((a, r) => a.add(r.value), new D(0)).toFixed(2),
    cogs: v("SHIPMENT").sub(v("RETURN")).toFixed(2), writtenOff: v("WRITE_OFF").toFixed(2), received: v("RECEIPT").toFixed(2),
  };
}

export { weighted };
