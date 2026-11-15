/**
 * Optional features FIRINGI switches on per company (Phase 27): Accounting, and the Assistant (the
 * business assistant for suppliers and customers). Off until FIRINGI switches it on for a supplier or a
 * customer; switching it off hides it and keeps what was recorded.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

export const COMPANY_FEATURES = ["ACCOUNTING", "ASSISTANT"] as const;
export type CompanyFeatureKey = (typeof COMPANY_FEATURES)[number];

export async function companyFeatureOn(companyId: string, key: CompanyFeatureKey) {
  const row = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key } } });
  return !!row?.enabled;
}

export class CompanyFeatureOffError extends AppError {
  constructor() { super("FEATURE_OFF", "FIRINGI hasn't switched this on for your company. Contact FIRINGI to use it.", 403); }
}

/** Nav feature keys that are off for the caller's company (hidden from the menu). */
export async function hiddenCompanyNav(ctx: Ctx): Promise<Set<string>> {
  if (ctx.company.type === "ADMIN") return new Set();
  const rows = await prisma.companyFeature.findMany({ where: { companyId: ctx.company.id, enabled: true } });
  return new Set(COMPANY_FEATURES.filter((k) => !rows.some((r) => r.key === k)));
}

function requireStaff(ctx: Ctx, manage: boolean) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.settings.manage" : ["admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
}

/** FIRINGI: every approved supplier and customer with its switches. */
export async function companiesWithFeatures(ctx: Ctx) {
  requireStaff(ctx, false);
  const rows = await prisma.company.findMany({
    where: { type: { in: ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"] }, status: "APPROVED", isInHouse: false },
    select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } }, features: true, _count: { select: { accountingEntries: true } } },
    orderBy: { legalName: "asc" },
  });
  return rows.map((c) => ({
    id: c.id, name: c.tradeName ?? c.legalName, legalName: c.legalName, type: c.type, country: c.country.code, entries: c._count.accountingEntries,
    accounting: !!c.features.find((f) => f.key === "ACCOUNTING")?.enabled, updatedAt: c.features.find((f) => f.key === "ACCOUNTING")?.updatedAt ?? null,
    assistant: !!c.features.find((f) => f.key === "ASSISTANT")?.enabled,
  }));
}

export async function setCompanyFeature(ctx: Ctx, companyId: string, key: CompanyFeatureKey, enabled: boolean) {
  requireStaff(ctx, true);
  if (!COMPANY_FEATURES.includes(key)) throw new ValidationError("Unknown feature.");
  const c = await prisma.company.findFirst({ where: { id: companyId, type: { in: ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"] } }, select: { id: true } });
  if (!c) throw new NotFoundError("Company");
  await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key } }, update: { enabled, updatedById: ctx.user.id }, create: { companyId, key, enabled, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: enabled ? "company_feature.enabled" : "company_feature.disabled", entityType: "Company", entityId: companyId, after: { key, enabled } });
}
