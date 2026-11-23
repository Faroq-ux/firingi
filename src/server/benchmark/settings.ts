import "server-only";
/**
 * Price benchmark (Phase 70): FIRINGI's switches — on/off, who sees it (customers, wholesalers, suppliers' price
 * position), each part, the minimum number of buyers in a group, the period, how often it is rebuilt, categories and
 * countries / kinds of business left out, the monthly "you could save" message and an override per business.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

const KEY = "benchmark.settings";
export const BENCH_PARTS = ["savings", "alternatives", "basket", "trend", "ai", "monthlyMessage"] as const;
export type BenchPart = (typeof BENCH_PARTS)[number];
export type BenchSettings = {
  enabled: boolean;
  audiences: { customers: boolean; wholesalers: boolean };
  supplierView: boolean;
  parts: Record<BenchPart, boolean>;
  /** a group is shown only with at least this many buyers (anonymity) */
  minBuyers: number;
  periodDays: number;
  refreshHours: number;
  /** the monthly message only from this yearly saving (€) */
  notifyMinSaving: number;
  /** trend warning: my price rose this many points faster than the market's */
  risePp: number;
  excludedCategoryIds: string[];
  offCountries: string[];
  offTypes: string[];
  companies: Record<string, "ON" | "OFF">;
};
export const DEFAULT_BENCH: BenchSettings = {
  enabled: true, audiences: { customers: true, wholesalers: true }, supplierView: true,
  parts: Object.fromEntries(BENCH_PARTS.map((p) => [p, true])) as Record<BenchPart, boolean>,
  minBuyers: 5, periodDays: 90, refreshHours: 24, notifyMinSaving: 25, risePp: 5, excludedCategoryIds: [], offCountries: [], offTypes: [], companies: {},
};
const int = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const strs = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 60))] : []);
export function mergeBench(v: Partial<BenchSettings> | null | undefined): BenchSettings {
  const s = v ?? {}, d = DEFAULT_BENCH;
  return {
    enabled: s.enabled ?? d.enabled, audiences: { ...d.audiences, ...(s.audiences ?? {}) }, supplierView: s.supplierView ?? d.supplierView,
    parts: { ...d.parts, ...(s.parts ?? {}) },
    minBuyers: int(s.minBuyers, d.minBuyers, 3, 50), periodDays: int(s.periodDays, d.periodDays, 30, 365), refreshHours: int(s.refreshHours, d.refreshHours, 1, 168),
    notifyMinSaving: int(s.notifyMinSaving, d.notifyMinSaving, 0, 100000), risePp: int(s.risePp, d.risePp, 1, 50),
    excludedCategoryIds: strs(s.excludedCategoryIds), offCountries: strs(s.offCountries).map((c) => c.toUpperCase()), offTypes: strs(s.offTypes),
    companies: Object.fromEntries(Object.entries(s.companies ?? {}).filter(([, x]) => x === "ON" || x === "OFF")) as Record<string, "ON" | "OFF">,
  };
}
export async function benchSettings(): Promise<BenchSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeBench(row?.value as Partial<BenchSettings> | null);
}
export async function saveBenchSettings(ctx: Ctx, input: Partial<BenchSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.manage", "admin.settings.manage"])) throw new ForbiddenError();
  const before = await benchSettings();
  const next = mergeBench({ ...before, ...input, companies: input.companies ?? before.companies });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "benchmark.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue });
  return next;
}
export async function setCompanyBench(ctx: Ctx, companyId: string, value: "ON" | "OFF" | null) {
  const s = await benchSettings();
  const companies = { ...s.companies };
  if (value) companies[companyId] = value; else delete companies[companyId];
  return saveBenchSettings(ctx, { companies });
}

type Co = { id: string; type: string; countryCode?: string; businessType?: string | null };
/** May this customer / wholesaler see its benchmark? */
export function buyerOn(s: BenchSettings, c: Co) {
  if (!s.enabled || !(c.type === "CUSTOMER" || c.type === "WHOLESALER")) return false;
  const o = s.companies[c.id];
  if (o === "OFF") return false;
  if (o === "ON") return true;
  if (c.countryCode && s.offCountries.includes(c.countryCode)) return false;
  if (c.businessType && s.offTypes.includes(c.businessType)) return false;
  return (c.type === "CUSTOMER" && s.audiences.customers) || (c.type === "WHOLESALER" && s.audiences.wholesalers);
}
/** May this supplier see where its prices sit? */
export function supplierOn(s: BenchSettings, c: Co) {
  if (!s.enabled || !s.supplierView || !(c.type === "DISTRIBUTOR" || c.type === "WHOLESALER")) return false;
  return s.companies[c.id] !== "OFF";
}
export async function benchOverrides(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const s = await benchSettings();
  const ids = Object.keys(s.companies);
  if (!ids.length) return [];
  const cos = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  return cos.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, state: s.companies[c.id] }));
}
