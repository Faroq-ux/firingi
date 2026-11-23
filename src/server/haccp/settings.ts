import "server-only";
/**
 * Food safety logbook (Phase 69): FIRINGI's switches — on/off, who uses it (customers, wholesalers), each part
 * (temperatures, checklists, cleaning, deliveries, cooling, training, photos, reports, reminders, AI), which
 * ready-made templates are offered, the rules (cooling, grace before a check is late, delivery limits, training
 * warning) and an override per business (Always on / Off).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { DEFAULT_RULES, TEMPLATE_KEYS, type HaccpRules } from "@/lib/haccp";

const KEY = "haccp.settings";
export const HACCP_PARTS = ["temperatures", "checklists", "cleaning", "deliveries", "cooling", "training", "photos", "reports", "reminders", "ai"] as const;
export type HaccpPart = (typeof HACCP_PARTS)[number];
export type HaccpSettings = {
  enabled: boolean;
  audiences: { customers: boolean; wholesalers: boolean };
  parts: Record<HaccpPart, boolean>;
  templates: Record<string, boolean>;
  rules: HaccpRules;
  companies: Record<string, "ON" | "OFF">;
};
export const DEFAULT_HACCP: HaccpSettings = {
  enabled: true,
  audiences: { customers: true, wholesalers: true },
  parts: Object.fromEntries(HACCP_PARTS.map((p) => [p, true])) as Record<HaccpPart, boolean>,
  templates: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, true])),
  rules: DEFAULT_RULES,
  companies: {},
};
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
export function mergeHaccp(v: Partial<HaccpSettings> | null | undefined): HaccpSettings {
  const s = v ?? {}, d = DEFAULT_HACCP, r = (s.rules ?? {}) as Partial<HaccpRules>;
  return {
    enabled: s.enabled ?? d.enabled,
    audiences: { ...d.audiences, ...(s.audiences ?? {}) },
    parts: { ...d.parts, ...(s.parts ?? {}) },
    templates: { ...d.templates, ...(s.templates ?? {}) },
    rules: {
      coolingTargetC: num(r.coolingTargetC, d.rules.coolingTargetC, -5, 30), coolingMaxMinutes: Math.round(num(r.coolingMaxMinutes, d.rules.coolingMaxMinutes, 15, 480)),
      graceMinutes: Math.round(num(r.graceMinutes, d.rules.graceMinutes, 0, 480)), trainingWarnDays: Math.round(num(r.trainingWarnDays, d.rules.trainingWarnDays, 1, 180)),
      deliveryChilledMaxC: num(r.deliveryChilledMaxC, d.rules.deliveryChilledMaxC, -5, 15), deliveryFrozenMaxC: num(r.deliveryFrozenMaxC, d.rules.deliveryFrozenMaxC, -30, 0),
    },
    companies: Object.fromEntries(Object.entries(s.companies ?? {}).filter(([, x]) => x === "ON" || x === "OFF")) as Record<string, "ON" | "OFF">,
  };
}

export async function haccpSettings(): Promise<HaccpSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeHaccp(row?.value as Partial<HaccpSettings> | null);
}

export async function saveHaccpSettings(ctx: Ctx, input: Partial<HaccpSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.haccp.manage", "admin.settings.manage"])) throw new ForbiddenError();
  const before = await haccpSettings();
  const next = mergeHaccp({ ...before, ...input, rules: { ...before.rules, ...(input.rules ?? {}) }, companies: input.companies ?? before.companies });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "haccp.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: next as unknown as Prisma.InputJsonValue });
  return next;
}

export async function setCompanyHaccp(ctx: Ctx, companyId: string, value: "ON" | "OFF" | null) {
  const s = await haccpSettings();
  const companies = { ...s.companies };
  if (value) companies[companyId] = value; else delete companies[companyId];
  return saveHaccpSettings(ctx, { companies });
}

/** May this customer / wholesaler use the logbook? */
export function haccpOn(s: HaccpSettings, c: { id: string; type: string }) {
  if (!s.enabled || !(c.type === "CUSTOMER" || c.type === "WHOLESALER")) return false;
  const o = s.companies[c.id];
  if (o === "OFF") return false;
  if (o === "ON") return true;
  return (c.type === "CUSTOMER" && s.audiences.customers) || (c.type === "WHOLESALER" && s.audiences.wholesalers);
}

/** The businesses with their own switch (names for the Settings tab). */
export async function haccpOverrides(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const s = await haccpSettings();
  const ids = Object.keys(s.companies);
  if (!ids.length) return [];
  const cos = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  return cos.map((c) => ({ id: c.id, name: c.tradeName ?? c.legalName, type: c.type, state: s.companies[c.id] }));
}
