import "server-only";
/**
 * Small orders per month (Phase 58). A small order is one FIRINGI delivers because it reached FIRINGI's minimum
 * order but not the wholesaler's free-delivery minimum. FIRINGI can limit how many a wholesale customer places per
 * calendar month (one number for all, per customer more / fewer / none / unlimited). Once used, an order must reach
 * the wholesaler's free-delivery minimum (or FIRINGI's free delivery). Checked at checkout on every channel.
 */
import type { CompanyType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

const KEY = "orders.smallOrders";
export type SmallOrderSettings = { enabled: boolean; perMonth: number };
export const DEFAULT_SMALL: SmallOrderSettings = { enabled: false, perMonth: 4 };

export async function smallOrderSettings(): Promise<SmallOrderSettings> {
  const v = (await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } }))?.value as Partial<SmallOrderSettings> | undefined;
  return { enabled: typeof v?.enabled === "boolean" ? v.enabled : DEFAULT_SMALL.enabled, perMonth: Number.isInteger(v?.perMonth) && v!.perMonth! >= 0 && v!.perMonth! <= 100 ? v!.perMonth! : DEFAULT_SMALL.perMonth };
}

const monthStart = (at = new Date()) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

/** This customer's limit this month and what is used (null limit = no limit). */
export async function smallOrderStatus(companyId: string, type: CompanyType, at = new Date()) {
  if (type !== "CUSTOMER") return { limit: null, used: 0, left: null };
  const s = await smallOrderSettings();
  if (!s.enabled) return { limit: null, used: 0, left: null };
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { smallOrdersPerMonth: true, smallOrdersUnlimited: true } });
  if (!co || co.smallOrdersUnlimited) return { limit: null, used: 0, left: null };
  const limit = co.smallOrdersPerMonth ?? s.perMonth;
  const used = await prisma.order.count({ where: { buyerCompanyId: companyId, smallOrder: true, status: { notIn: ["CANCELLED"] }, placedAt: { gte: monthStart(at) } } });
  return { limit, used, left: Math.max(0, limit - used) };
}

export async function smallOrdersLeft(companyId: string, type: CompanyType) {
  return (await smallOrderStatus(companyId, type)).left;
}

export async function saveSmallOrderSettings(ctx: Ctx, i: SmallOrderSettings) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  if (!Number.isInteger(i.perMonth) || i.perMonth < 0 || i.perMonth > 100) throw new ValidationError("Small orders per month: 0 to 100.");
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const value = { enabled: i.enabled, perMonth: i.perMonth } as unknown as Prisma.InputJsonValue;
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "orders.small_orders_settings", entityType: "Setting", entityId: KEY, after: i });
}

/** FIRINGI: a customer's own limit (null = the general one) or no limit. */
export async function setCompanySmallOrders(ctx: Ctx, companyId: string, i: { perMonth: number | null; unlimited: boolean }) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.customers.manage", "admin.settings.manage"])) throw new ForbiddenError();
  if (i.perMonth != null && (!Number.isInteger(i.perMonth) || i.perMonth < 0 || i.perMonth > 100)) throw new ValidationError("Small orders per month: 0 to 100.");
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true, smallOrdersPerMonth: true, smallOrdersUnlimited: true } });
  if (!c) throw new NotFoundError();
  if (c.type !== "CUSTOMER") throw new ValidationError("The limit is for wholesale customers.");
  await prisma.company.update({ where: { id: companyId }, data: { smallOrdersPerMonth: i.perMonth, smallOrdersUnlimited: i.unlimited } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "orders.small_orders_company", entityType: "Company", entityId: companyId, before: c, after: i });
}

/** The customer's own view (cart and WhatsApp): how many small orders are left this month. */
export async function mySmallOrders(ctx: Ctx) {
  return smallOrderStatus(ctx.company.id, ctx.company.type);
}
