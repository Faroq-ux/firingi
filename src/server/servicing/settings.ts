import "server-only";
/**
 * Services & used cooking oil (Phase 68): FIRINGI's switches — on/off, who may use services (customers,
 * wholesalers), who may provide them (distributors, wholesalers, FIRINGI itself), each part (scheduled plans,
 * requests, fryers & oil, invoicing, oil buy-back, documents, AI), the oil rules, reminder / missed hours and an
 * override per business (Always on / Off).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { DEFAULT_OIL, type OilRules } from "@/lib/services";

const KEY = "services.settings";
export type ServicesSettings = {
  enabled: boolean;
  audiences: { customers: boolean; wholesalers: boolean };
  providers: { distributors: boolean; wholesalers: boolean; firingi: boolean };
  /** suppliers may ask to provide a service themselves (off: only FIRINGI adds providers) */
  selfApply: boolean;
  parts: { scheduled: boolean; onRequest: boolean; oil: boolean; invoicing: boolean; buyback: boolean; documents: boolean; ai: boolean };
  oil: OilRules;
  /** a reminder this many hours before a visit */
  reminderHours: number;
  /** a visit not done this many hours after its day is missed */
  missedAfterHours: number;
  /** visits are planned this many days ahead */
  daysAhead: number;
  /** a request can be for tomorrow at the earliest (days) */
  requestLeadDays: number;
  /** per business: ON (always) / OFF */
  companies: Record<string, "ON" | "OFF">;
};
export const DEFAULT_SERVICES: ServicesSettings = {
  enabled: true,
  audiences: { customers: true, wholesalers: true },
  providers: { distributors: true, wholesalers: true, firingi: true },
  selfApply: false,
  parts: { scheduled: true, onRequest: true, oil: true, invoicing: true, buyback: true, documents: true, ai: true },
  oil: DEFAULT_OIL, reminderHours: 24, missedAfterHours: 24, daysAhead: 35, requestLeadDays: 1, companies: {},
};
const int = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
export function mergeServices(v: Partial<ServicesSettings> | null | undefined): ServicesSettings {
  const s = v ?? {}, d = DEFAULT_SERVICES;
  return {
    enabled: s.enabled ?? d.enabled,
    audiences: { ...d.audiences, ...(s.audiences ?? {}) },
    providers: { ...d.providers, ...(s.providers ?? {}) },
    selfApply: typeof s.selfApply === "boolean" ? s.selfApply : d.selfApply,
    parts: { ...d.parts, ...(s.parts ?? {}) },
    oil: { changeDays: int(s.oil?.changeDays, d.oil.changeDays, 1, 60), warnPolarPct: int(s.oil?.warnPolarPct, d.oil.warnPolarPct, 5, 40), maxPolarPct: int(s.oil?.maxPolarPct, d.oil.maxPolarPct, 10, 40), fullPct: int(s.oil?.fullPct, d.oil.fullPct, 30, 100) },
    reminderHours: int(s.reminderHours, d.reminderHours, 1, 168), missedAfterHours: int(s.missedAfterHours, d.missedAfterHours, 1, 168),
    daysAhead: int(s.daysAhead, d.daysAhead, 7, 120), requestLeadDays: int(s.requestLeadDays, d.requestLeadDays, 0, 14),
    companies: Object.fromEntries(Object.entries(s.companies ?? {}).filter(([, x]) => x === "ON" || x === "OFF")) as Record<string, "ON" | "OFF">,
  };
}

export async function servicesSettings(): Promise<ServicesSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeServices(row?.value as Partial<ServicesSettings> | null);
}

export async function saveServicesSettings(ctx: Ctx, input: Partial<ServicesSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.services.manage", "admin.settings.manage"])) throw new ForbiddenError();
  const before = await servicesSettings();
  const next = mergeServices({ ...before, ...input, oil: { ...before.oil, ...(input.oil ?? {}) }, companies: input.companies ?? before.companies });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue });
  return next;
}

/** Override for one business: ON (always), OFF, or null (follow the switches). */
export async function setCompanyServices(ctx: Ctx, companyId: string, value: "ON" | "OFF" | null) {
  const s = await servicesSettings();
  const companies = { ...s.companies };
  if (value) companies[companyId] = value; else delete companies[companyId];
  return saveServicesSettings(ctx, { companies });
}

type Co = { id: string; type: string };
/** May this customer / wholesaler use services (buy portal)? */
export function customerOn(s: ServicesSettings, c: Co) {
  if (!s.enabled) return false;
  const o = s.companies[c.id];
  if (o === "OFF") return false;
  if (o === "ON") return c.type === "CUSTOMER" || c.type === "WHOLESALER";
  return (c.type === "CUSTOMER" && s.audiences.customers) || (c.type === "WHOLESALER" && s.audiences.wholesalers);
}
/** May this company be a provider? */
export function providerOn(s: ServicesSettings, c: Co) {
  if (!s.enabled) return false;
  if (c.type === "ADMIN") return s.providers.firingi;
  const o = s.companies[c.id];
  if (o === "OFF") return false;
  if (o === "ON") return c.type === "DISTRIBUTOR" || c.type === "WHOLESALER";
  return (c.type === "DISTRIBUTOR" && s.providers.distributors) || (c.type === "WHOLESALER" && s.providers.wholesalers);
}
export async function servicesAccess(c: Co) {
  const s = await servicesSettings();
  return { on: customerOn(s, c), oil: customerOn(s, c) && s.parts.oil, s };
}
export async function providerAccess(c: Co) {
  const s = await servicesSettings();
  return { on: providerOn(s, c), s };
}

/** The businesses with their own switch (names for the Settings tab). */
export async function overrideCompanies(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const s = await servicesSettings();
  const ids = Object.keys(s.companies);
  if (!ids.length) return [];
  const cos = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  return cos.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, state: s.companies[c.id] }));
}
