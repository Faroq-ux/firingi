import "server-only";
/**
 * Pre-orders and price locks (Phase 71): FIRINGI's switches — on/off, which sellers may offer them (distributors,
 * wholesalers), each part (campaigns, price locks, deposits, AI), campaign kinds, approval, limits, countries left out
 * and an override per company (seller or buyer).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { ForbiddenError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { CAMPAIGN_KINDS, buyerTypeFor, type CampaignKind } from "@/lib/preorders";

const KEY = "preorders.settings";
export const PRE_PARTS = ["campaigns", "priceLocks", "deposits", "ai"] as const;
export type PrePart = (typeof PRE_PARTS)[number];
export type PreSettings = {
  enabled: boolean;
  /** which sellers may offer pre-orders and price locks */
  sellers: { DISTRIBUTOR: boolean; WHOLESALER: boolean };
  parts: Record<PrePart, boolean>;
  kinds: Record<CampaignKind, boolean>;
  /** ALWAYS: FIRINGI approves every campaign; AUTO: campaigns open without review */
  approval: "ALWAYS" | "AUTO";
  maxCampaignDays: number;
  maxDeliveryDates: number;
  maxDepositPct: number;
  maxLockMonths: number;
  /** price locks above this value (€) need FIRINGI's approval after the supplier accepts (0 = never) */
  lockReviewAbove: number;
  /** orders are placed this many days before each delivery date */
  orderDaysBefore: number;
  /** a buyer given less than asked confirms within these days (then it is confirmed automatically) */
  confirmDays: number;
  /** price-lock reminder this many days before it ends */
  lockRemindDays: number;
  offCountries: string[];
  companies: Record<string, "ON" | "OFF">;
};
export const DEFAULT_PRE: PreSettings = {
  enabled: true, sellers: { DISTRIBUTOR: true, WHOLESALER: true },
  parts: Object.fromEntries(PRE_PARTS.map((p) => [p, true])) as Record<PrePart, boolean>,
  kinds: Object.fromEntries(CAMPAIGN_KINDS.map((k) => [k, true])) as Record<CampaignKind, boolean>,
  approval: "ALWAYS", maxCampaignDays: 120, maxDeliveryDates: 6, maxDepositPct: 30, maxLockMonths: 12, lockReviewAbove: 0,
  orderDaysBefore: 2, confirmDays: 3, lockRemindDays: 14, offCountries: [], companies: {},
};
const int = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const strs = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 60))] : []);
export function mergePre(v: Partial<PreSettings> | null | undefined): PreSettings {
  const s = v ?? {}, d = DEFAULT_PRE;
  return {
    enabled: s.enabled ?? d.enabled, sellers: { ...d.sellers, ...(s.sellers ?? {}) },
    parts: { ...d.parts, ...(s.parts ?? {}) }, kinds: { ...d.kinds, ...(s.kinds ?? {}) },
    approval: s.approval === "AUTO" ? "AUTO" : "ALWAYS",
    maxCampaignDays: int(s.maxCampaignDays, d.maxCampaignDays, 1, 365), maxDeliveryDates: int(s.maxDeliveryDates, d.maxDeliveryDates, 1, 24),
    maxDepositPct: int(s.maxDepositPct, d.maxDepositPct, 0, 100), maxLockMonths: int(s.maxLockMonths, d.maxLockMonths, 1, 24),
    lockReviewAbove: int(s.lockReviewAbove, d.lockReviewAbove, 0, 10_000_000), orderDaysBefore: int(s.orderDaysBefore, d.orderDaysBefore, 0, 30),
    confirmDays: int(s.confirmDays, d.confirmDays, 1, 30), lockRemindDays: int(s.lockRemindDays, d.lockRemindDays, 1, 60),
    offCountries: strs(s.offCountries).map((c) => c.toUpperCase()),
    companies: Object.fromEntries(Object.entries(s.companies ?? {}).filter(([, x]) => x === "ON" || x === "OFF")) as Record<string, "ON" | "OFF">,
  };
}
export async function preSettings(): Promise<PreSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergePre(row?.value as Partial<PreSettings> | null);
}
export const MANAGE: PermissionCode[] = ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"];
export const ADMIN_VIEW: PermissionCode[] = ["admin.orders.view", "admin.orders.manage", "admin.pricing.view", "admin.pricing.manage", "admin.settings.manage"];
export async function savePreSettings(ctx: Ctx, input: Partial<PreSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, MANAGE)) throw new ForbiddenError();
  const before = await preSettings();
  const next = mergePre({ ...before, ...input, companies: input.companies ?? before.companies });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "preorders.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue });
  return next;
}
export async function setCompanyPre(ctx: Ctx, companyId: string, value: "ON" | "OFF" | null) {
  const s = await preSettings();
  const companies = { ...s.companies };
  if (value) companies[companyId] = value; else delete companies[companyId];
  return savePreSettings(ctx, { companies });
}

type Co = { id: string; type: string; countryCode?: string };
/** May this distributor / wholesaler offer pre-orders (campaigns) or price locks? */
export function sellerOn(s: PreSettings, c: Co, part: "campaigns" | "priceLocks") {
  if (!s.enabled || !s.parts[part] || !(c.type === "DISTRIBUTOR" || c.type === "WHOLESALER")) return false;
  const o = s.companies[c.id];
  if (o === "OFF") return false;
  if (o === "ON") return true;
  if (c.countryCode && s.offCountries.includes(c.countryCode.toUpperCase())) return false;
  return s.sellers[c.type as "DISTRIBUTOR" | "WHOLESALER"];
}
/** May this customer / wholesaler pre-order or lock prices (from sellers of the type that sells to it)? */
export function buyerOn(s: PreSettings, c: Co, part: "campaigns" | "priceLocks") {
  if (!s.enabled || !s.parts[part] || !(c.type === "CUSTOMER" || c.type === "WHOLESALER")) return false;
  const o = s.companies[c.id];
  if (o === "OFF") return false;
  if (c.countryCode && s.offCountries.includes(c.countryCode.toUpperCase()) && o !== "ON") return false;
  // the sellers that sell to this buyer must be switched on
  return c.type === "CUSTOMER" ? s.sellers.WHOLESALER : s.sellers.DISTRIBUTOR;
}
/** The seller type a buyer pre-orders from. */
export const sellerTypeForBuyer = (buyerType: string) => (buyerType === "WHOLESALER" ? "DISTRIBUTOR" : "WHOLESALER");
export { buyerTypeFor };

/** For the menu: what this company sees. */
export async function preAccess(company: { id: string; type: string; country?: { code: string } | null; countryId?: string }) {
  const s = await preSettings();
  const code = company.country?.code ?? (company.countryId ? (await prisma.country.findUnique({ where: { id: company.countryId }, select: { code: true } }))?.code : undefined);
  const c = { id: company.id, type: company.type, countryCode: code };
  return {
    s,
    buyerCampaigns: buyerOn(s, c, "campaigns"), buyerLocks: buyerOn(s, c, "priceLocks"),
    sellerCampaigns: sellerOn(s, c, "campaigns"), sellerLocks: sellerOn(s, c, "priceLocks"),
  };
}

/** FIRINGI: the companies switched on or off one by one. */
export async function preOverrideList(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ADMIN_VIEW)) throw new ForbiddenError();
  const s = await preSettings();
  const ids = Object.keys(s.companies);
  const cos = ids.length ? await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } }) : [];
  return cos.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, state: s.companies[c.id] as "ON" | "OFF" })).sort((a, b) => a.name.localeCompare(b.name));
}
