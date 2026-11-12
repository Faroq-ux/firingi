/**
 * Warehouse features per supplier (Phase 25). FIRINGI switches each supplier's pick & pack,
 * shelves, lot traceability and own recalls on or off; a supplier without a row has everything on.
 * Inside the company, who may use them is the supplier's own business (team roles & permissions).
 * Recall notices to buyers and recalls started by FIRINGI are never switched off.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

export const WAREHOUSE_FEATURES = ["PICK_PACK", "BINS", "TRACE", "RECALLS"] as const;
export type WarehouseFeature = (typeof WAREHOUSE_FEATURES)[number];
export type WarehouseFlags = { pickPack: boolean; bins: boolean; traceability: boolean; recalls: boolean };
export const WH_FIELD: Record<WarehouseFeature, keyof WarehouseFlags> = { PICK_PACK: "pickPack", BINS: "bins", TRACE: "traceability", RECALLS: "recalls" };
export const WH_LABEL: Record<WarehouseFeature, string> = { PICK_PACK: "Pick & pack + scanning", BINS: "Shelves (bins)", TRACE: "Lot traceability", RECALLS: "Supplier recalls" };
const ALL_ON: WarehouseFlags = { pickPack: true, bins: true, traceability: true, recalls: true };

export async function warehouseFeatures(companyId: string): Promise<WarehouseFlags> {
  const row = await prisma.warehouseFeatures.findUnique({ where: { companyId } });
  return row ? { pickPack: row.pickPack, bins: row.bins, traceability: row.traceability, recalls: row.recalls } : ALL_ON;
}

/** Is the feature on for the caller's company? FIRINGI staff are never limited. */
export async function featureOn(ctx: Ctx, ...any: WarehouseFeature[]) {
  if (ctx.company.type === "ADMIN") return true;
  const f = await warehouseFeatures(ctx.company.id);
  return any.some((x) => f[WH_FIELD[x]]);
}

export class FeatureOffError extends AppError {
  constructor() { super("FEATURE_OFF", "FIRINGI has switched this off for your company. Contact FIRINGI to use it.", 403); }
}

/** Throws when none of the given features is on for the caller's company. */
export async function requireWarehouseFeature(ctx: Ctx, ...any: WarehouseFeature[]) {
  if (!(await featureOn(ctx, ...any))) throw new FeatureOffError();
}

/** Nav keys hidden for a supplier (sidebar and command palette). */
export async function hiddenWarehouseNav(ctx: Ctx): Promise<Set<string>> {
  if (ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") return new Set();
  const f = await warehouseFeatures(ctx.company.id);
  return new Set(WAREHOUSE_FEATURES.filter((x) => !f[WH_FIELD[x]]));
}

function requireStaff(ctx: Ctx, manage: boolean) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.inventory.manage" : ["admin.inventory.view", "admin.inventory.manage"])) throw new ForbiddenError();
}

/** FIRINGI: every supplier with its switches. */
export async function supplierWarehouseFeatures(ctx: Ctx) {
  requireStaff(ctx, false);
  const companies = await prisma.company.findMany({
    where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" },
    select: { id: true, legalName: true, tradeName: true, type: true, isInHouse: true, warehouseFeatures: true },
    orderBy: { legalName: "asc" },
  });
  return companies.map((c) => {
    const r = c.warehouseFeatures;
    return { id: c.id, name: c.tradeName ?? c.legalName, type: c.type, inHouse: c.isInHouse, custom: !!r, features: r ? { pickPack: r.pickPack, bins: r.bins, traceability: r.traceability, recalls: r.recalls } : ALL_ON };
  });
}

export async function setWarehouseFeature(ctx: Ctx, companyId: string, feature: WarehouseFeature, on: boolean) {
  requireStaff(ctx, true);
  const c = await prisma.company.findFirst({ where: { id: companyId, type: { in: ["DISTRIBUTOR", "WHOLESALER"] } }, select: { id: true } });
  if (!c) throw new NotFoundError("Supplier");
  const field = WH_FIELD[feature];
  const before = await warehouseFeatures(companyId);
  await prisma.warehouseFeatures.upsert({ where: { companyId }, update: { [field]: on, updatedById: ctx.user.id }, create: { companyId, ...ALL_ON, [field]: on, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.feature_switched", entityType: "Company", entityId: companyId, before: { [feature]: before[field] }, after: { [feature]: on } });
}

/** Back to everything on. */
export async function resetWarehouseFeatures(ctx: Ctx, companyId: string) {
  requireStaff(ctx, true);
  await prisma.warehouseFeatures.deleteMany({ where: { companyId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "warehouse.features_reset", entityType: "Company", entityId: companyId });
}
