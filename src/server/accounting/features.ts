/**
 * Optional features per company (Phase 27): Accounting — off until FIRINGI switches it on; and the
 * Assistant (the AI support & sales agent for customers and suppliers) — on for everyone unless FIRINGI
 * switches it off for a company — and photos & barcode scan in that Assistant (same default). Switching a
 * feature off hides it and keeps what was recorded.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

export const COMPANY_FEATURES = ["ACCOUNTING", "ASSISTANT", "ASSISTANT_PHOTOS", "LOYALTY", "ADS"] as const;
export type CompanyFeatureKey = (typeof COMPANY_FEATURES)[number];
/** On for every company unless FIRINGI switched it off (the Assistant is the support & sales channel). */
const DEFAULT_ON: Record<CompanyFeatureKey, boolean> = { ACCOUNTING: false, ASSISTANT: true, ASSISTANT_PHOTOS: true, LOYALTY: true, ADS: true };

export async function companyFeatureOn(companyId: string, key: CompanyFeatureKey) {
  const row = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key } } });
  return row ? row.enabled : DEFAULT_ON[key];
}

export class CompanyFeatureOffError extends AppError {
  constructor() { super("FEATURE_OFF", "FIRINGI hasn't switched this on for your company. Contact FIRINGI to use it.", 403); }
}

/**
 * Nav feature keys that are off for the caller's company (hidden from the menu). In the customer
 * ("buy") and supplier ("vendor") portals the Assistant is also hidden when FIRINGI switched it off for
 * all customers / all suppliers (AI settings).
 */
export async function hiddenCompanyNav(ctx: Ctx, portal?: "buy" | "vendor"): Promise<Set<string>> {
  if (ctx.company.type === "ADMIN") return new Set();
  const rows = await prisma.companyFeature.findMany({ where: { companyId: ctx.company.id } });
  const off = new Set<string>(COMPANY_FEATURES.filter((k) => !(rows.find((r) => r.key === k)?.enabled ?? DEFAULT_ON[k])));
  if (portal) {
    const { aiSettings } = await import("@/server/ai/assistant");
    const s = await aiSettings();
    if (!(portal === "buy" ? s.buyers : s.suppliers)) off.add("ASSISTANT");
    if (portal === "buy" && !(await (await import("@/server/loyalty/service")).loyaltySettings()).enabled) off.add("LOYALTY");
    if (portal === "vendor" && !(await (await import("@/server/ads/service")).adsSettings()).enabled) off.add("ADS");
  }
  return off;
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
    assistant: c.features.find((f) => f.key === "ASSISTANT")?.enabled ?? DEFAULT_ON.ASSISTANT,
    photos: c.features.find((f) => f.key === "ASSISTANT_PHOTOS")?.enabled ?? DEFAULT_ON.ASSISTANT_PHOTOS,
    loyalty: c.type === "DISTRIBUTOR" ? null : c.features.find((f) => f.key === "LOYALTY")?.enabled ?? DEFAULT_ON.LOYALTY,
    ads: c.type === "CUSTOMER" ? null : c.features.find((f) => f.key === "ADS")?.enabled ?? DEFAULT_ON.ADS,
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
