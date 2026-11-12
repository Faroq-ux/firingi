/**
 * Shelves (bins) — Phase 25. A supplier names the shelf locations of each warehouse (aisle-rack-level,
 * e.g. "A-01-3"), puts lots on them, and moves them around. Pick lists walk the shelves in order.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { moveToBin } from "@/server/inventory/ledger";
import { ownWarehouse, requireInventory, warehouses, daysLeft } from "@/server/inventory/service";
import { pickLocalized } from "@/i18n/config";
import { requireWarehouseFeature } from "./features";

export const MANAGE = ["vendor.inventory.manage"] as const;
export const SEE = ["vendor.inventory.view", "vendor.inventory.manage", "vendor.warehouse.pick"] as const;
export const PICK = ["vendor.warehouse.pick", "vendor.inventory.manage"] as const;

const CODE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,23}$/;
export const normCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "-");
/** Walking order: by the sort number, then the code with numbers compared as numbers. */
export const sortKey = (b: { sortOrder: number; code: string } | null | undefined) =>
  b ? `${String(b.sortOrder).padStart(6, "0")}|${b.code.replace(/\d+/g, (d) => d.padStart(6, "0"))}` : "999999|~";

export async function ownBin(ctx: Ctx, id: string) {
  const b = await prisma.bin.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!b) throw new NotFoundError("Shelf");
  return b;
}

/** Shelves of a warehouse with what is on them (units, lots, earliest best-before). */
export async function listBins(ctx: Ctx, addressId?: string) {
  requireInventory(ctx, [...SEE]);
  await requireWarehouseFeature(ctx, "BINS", "PICK_PACK");
  const wh = await warehouses(ctx);
  const ids = addressId ? [addressId] : wh.map((w) => w.id);
  const bins = await prisma.bin.findMany({ where: { companyId: ctx.company.id, addressId: { in: ids } }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  const batches = await prisma.stockBatch.groupBy({ by: ["binId"], where: { binId: { in: bins.map((b) => b.id) }, onHand: { gt: 0 }, blockedAt: null, writtenOffAt: null }, _sum: { onHand: true }, _count: { _all: true }, _min: { expiresOn: true } });
  const whName = new Map(wh.map((w) => [w.id, w.label]));
  return bins
    .map((b) => {
      const g = batches.find((x) => x.binId === b.id);
      return { id: b.id, code: b.code, zone: b.zone, sortOrder: b.sortOrder, isActive: b.isActive, addressId: b.addressId, warehouse: whName.get(b.addressId) ?? "", units: g?._sum.onHand ?? 0, lots: g?._count._all ?? 0, nextExpiry: g?._min.expiresOn ?? null };
    })
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export async function createBin(ctx: Ctx, i: { addressId: string; code: string; zone?: string | null; sortOrder?: number | null }) {
  requireInventory(ctx, [...MANAGE]);
  await requireWarehouseFeature(ctx, "BINS");
  await ownWarehouse(ctx, i.addressId);
  const code = normCode(i.code);
  if (!CODE.test(code)) throw new ValidationError("Use letters, numbers, - . / (up to 24 characters).");
  if (await prisma.bin.findUnique({ where: { addressId_code: { addressId: i.addressId, code } } })) throw new ValidationError(`Shelf ${code} already exists in this warehouse.`);
  const b = await prisma.bin.create({ data: { companyId: ctx.company.id, addressId: i.addressId, code, zone: i.zone?.trim() || null, sortOrder: i.sortOrder ?? 0 } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.bin_created", entityType: "Bin", entityId: b.id, after: { code } });
  return b;
}

/**
 * Many shelves at once: aisles × racks × levels → "A-01-1" … The walking order follows the
 * aisles (A, B, …), racks up the aisle and levels bottom to top. Existing codes are skipped.
 */
export async function createBinRange(ctx: Ctx, i: { addressId: string; aisles: string; racks: number; levels: number; zone?: string | null }) {
  requireInventory(ctx, [...MANAGE]);
  await requireWarehouseFeature(ctx, "BINS");
  await ownWarehouse(ctx, i.addressId);
  const aisles = i.aisles.split(/[,\s]+/).map((a) => normCode(a)).filter(Boolean);
  if (!aisles.length || aisles.some((a) => !/^[A-Z0-9]{1,4}$/.test(a))) throw new ValidationError("Aisles: letters or numbers, separated by commas (e.g. A, B, C).");
  if (!Number.isInteger(i.racks) || i.racks < 1 || i.racks > 99 || !Number.isInteger(i.levels) || i.levels < 1 || i.levels > 9) throw new ValidationError("Racks 1–99, levels 1–9.");
  if (aisles.length * i.racks * i.levels > 2000) throw new ValidationError("At most 2000 shelves at once.");
  const existing = new Set((await prisma.bin.findMany({ where: { addressId: i.addressId }, select: { code: true } })).map((b) => b.code));
  const data = [];
  let n = 0;
  for (const [ai, a] of aisles.entries())
    for (let r = 1; r <= i.racks; r++)
      for (let l = 1; l <= i.levels; l++) {
        const code = `${a}-${String(r).padStart(2, "0")}-${l}`;
        n++;
        if (!existing.has(code)) data.push({ companyId: ctx.company.id, addressId: i.addressId, code, zone: i.zone?.trim() || null, sortOrder: (ai + 1) * 1000 + r * 10 + l });
      }
  if (data.length) await prisma.bin.createMany({ data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.bins_created", entityType: "Address", entityId: i.addressId, after: { created: data.length, aisles, racks: i.racks, levels: i.levels } });
  return { created: data.length, skipped: n - data.length };
}

export async function updateBin(ctx: Ctx, i: { id: string; zone?: string | null; sortOrder?: number | null; isActive?: boolean }) {
  requireInventory(ctx, [...MANAGE]);
  await requireWarehouseFeature(ctx, "BINS");
  const b = await ownBin(ctx, i.id);
  if (i.isActive === false) {
    const on = await prisma.stockBatch.count({ where: { binId: b.id, onHand: { gt: 0 }, blockedAt: null } });
    if (on) throw new ValidationError("Move the lots off this shelf first.");
  }
  await prisma.bin.update({ where: { id: b.id }, data: { ...(i.zone !== undefined ? { zone: i.zone?.trim() || null } : {}), ...(i.sortOrder != null ? { sortOrder: i.sortOrder } : {}), ...(i.isActive !== undefined ? { isActive: i.isActive } : {}) } });
}

export type BatchRow = Awaited<ReturnType<typeof batchRows>>[number];

/** Lots in stock (on a shelf or not yet), with product, shelf and best-before. */
export async function batchRows(ctx: Ctx, where: { addressId?: string; binId?: string | null; offerId?: string; ids?: string[] }, locale: string) {
  const rows = await prisma.stockBatch.findMany({
    where: {
      offer: { vendorCompanyId: ctx.company.id }, onHand: { gt: 0 }, blockedAt: null, writtenOffAt: null,
      ...(where.addressId ? { addressId: where.addressId } : {}), ...(where.binId !== undefined ? { binId: where.binId } : {}),
      ...(where.offerId ? { offerId: where.offerId } : {}), ...(where.ids ? { id: { in: where.ids } } : {}),
    },
    include: { bin: { select: { id: true, code: true } }, address: { select: { label: true } }, offer: { select: { id: true, vendorSku: true, packaging: { select: { name: true, gtin: true, variant: { select: { gtin: true, product: { select: { name: true } } } } } } } } },
    orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }],
    take: 500,
  });
  return rows.map((b) => ({
    id: b.id, offerId: b.offerId, sku: b.offer.vendorSku, product: pickLocalized(b.offer.packaging.variant.product.name, locale), packaging: pickLocalized(b.offer.packaging.name, locale),
    gtin: b.offer.packaging.gtin ?? b.offer.packaging.variant.gtin, lotCode: b.lotCode, expiresOn: b.expiresOn, daysLeft: daysLeft(b.expiresOn),
    onHand: b.onHand, reserved: b.reserved, free: b.onHand - b.reserved, bin: b.bin, addressId: b.addressId, warehouse: b.address.label,
  }));
}

export async function binDetail(ctx: Ctx, id: string, locale: string) {
  requireInventory(ctx, [...SEE]);
  await requireWarehouseFeature(ctx, "BINS");
  const b = await ownBin(ctx, id);
  const wh = await prisma.address.findUniqueOrThrow({ where: { id: b.addressId }, select: { label: true } });
  return { bin: { ...b, warehouse: wh.label }, lots: await batchRows(ctx, { binId: b.id }, locale) };
}

/** Lots in a warehouse that are on no shelf yet. */
export async function unshelved(ctx: Ctx, addressId: string | undefined, locale: string) {
  requireInventory(ctx, [...SEE]);
  await requireWarehouseFeature(ctx, "BINS");
  return batchRows(ctx, { addressId, binId: null }, locale);
}

/** Put a lot (or part of it) on a shelf of the same warehouse. */
export async function putAway(ctx: Ctx, i: { batchId: string; binId: string; qty?: number | null }) {
  requireInventory(ctx, [...PICK]);
  await requireWarehouseFeature(ctx, "BINS");
  const batch = await prisma.stockBatch.findFirst({ where: { id: i.batchId, offer: { vendorCompanyId: ctx.company.id } }, include: { bin: true } });
  if (!batch) throw new NotFoundError("Lot");
  const bin = await ownBin(ctx, i.binId);
  if (!bin.isActive) throw new ValidationError("This shelf is not in use.");
  if (bin.addressId !== batch.addressId) throw new ValidationError("That shelf is in another warehouse — use a transfer.");
  const qty = i.qty ?? batch.onHand;
  const id = await prisma.$transaction((tx) => moveToBin(tx, { batchId: batch.id, qty, binId: bin.id, byUserId: ctx.user.id, note: `${batch.bin?.code ?? "—"} → ${bin.code}` }));
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.put_away", entityType: "StockBatch", entityId: batch.id, after: { bin: bin.code, qty, batchId: id } });
  return { batchId: id, bin: bin.code, qty };
}
