/**
 * Phase 47 — POS: FIRINGI's settings and who may use the till. The admin switches the till on/off overall, per
 * company type (distributors, wholesalers, wholesale customers), per country (with its fiscal stage and provider)
 * and per company.
 */
import "server-only";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import type { Tx } from "@/server/db";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { mergePosSettings, posAllowed, posCurrency, posDecimals, type PosSettings } from "@/lib/pos";

export const POS_KEY = "pos.settings";

export async function posSettings(db: Tx = prisma): Promise<PosSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: POS_KEY } });
  return mergePosSettings(row?.value ?? null);
}

export async function savePosSettings(ctx: Ctx, raw: unknown) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const value = mergePosSettings(raw);
  const before = await posSettings();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: POS_KEY } },
    update: { value: value as never, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", scopeId: "", key: POS_KEY, value: value as never, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pos.settings", entityType: "Setting", entityId: POS_KEY, before: before as never, after: value as never });
  return value;
}

/** What FIRINGI allows a company, and how its country's receipts work. */
export async function posAccess(companyId: string, db: Tx = prisma) {
  const [s, co, pc] = await Promise.all([
    posSettings(db),
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { type: true, status: true, country: { select: { code: true } } } }),
    db.posCompany.findUnique({ where: { companyId } }),
  ]);
  const allowed = co.status === "APPROVED" ? posAllowed(s, { type: co.type, countryCode: co.country.code, adminState: pc?.adminState }) : { on: false, reason: "company" as const };
  const country = s.countries[co.country.code];
  const currency = posCurrency(co.country.code);
  const connected = !!(pc?.fiscalProvider && pc.fiscalSecretEnc && pc.fiscalProvider === country?.provider);
  // a country on a certified provider: a business that hasn't connected its account sells only if FIRINGI allows non-fiscal meanwhile
  const stage: "NONFISCAL" | "PROVIDER" = country?.stage === "PROVIDER" && connected ? "PROVIDER" : "NONFISCAL";
  const blocked = country?.stage === "PROVIDER" && !connected && !country.fallbackNonFiscal;
  return {
    ...allowed, settings: s, countryCode: co.country.code, type: co.type, currency, decimals: posDecimals(currency),
    stage, provider: country?.provider ?? null, countryStage: country?.stage ?? "NONFISCAL", connected, blocked, company: pc,
  };
}
export type PosAccess = Awaited<ReturnType<typeof posAccess>>;

/** The till's portal: suppliers sell from /vendor, wholesale customers from /buy. */
export const posPortal = (type: string) => (type === "CUSTOMER" ? "buy" : "vendor");

export async function requirePos(ctx: Ctx, need: "sell" | "manage" = "sell") {
  if (ctx.company.type === "ADMIN") throw new ForbiddenError();
  const a = await posAccess(ctx.company.id);
  if (!a.on) throw new ForbiddenError("FIRINGI hasn't switched the till on for your company.");
  const perms = need === "manage" ? ["company.pos.manage"] : ["company.pos.sell", "company.pos.manage"];
  if (!can(ctx, perms as ("company.pos.manage" | "company.pos.sell")[])) throw new ForbiddenError();
  return a;
}

export const mayManage = (ctx: Ctx) => can(ctx, "company.pos.manage");
