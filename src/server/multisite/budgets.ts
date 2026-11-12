/**
 * Budgets (Phase 27): a weekly or monthly spending limit (incl. VAT) for a branch or for the whole
 * company, optionally only for products of some categories. What happens to an order that would go
 * over it is the company's choice: it needs a manager's approval, it is refused, or it is placed and
 * the managers are told. Spend = orders placed in the period (not cancelled). Alerts at 80 % and 100 %.
 * Weeks start on Monday; periods are in UTC days.
 */
import Decimal from "decimal.js";
import { Prisma, type BudgetAction, type BudgetPeriod } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { NotFoundError, ValidationError, ForbiddenError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { MANAGE, branchScope } from "./branches";

export function periodBounds(period: BudgetPeriod, at = new Date()) {
  if (period === "MONTHLY") {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    return { start, end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)) };
  }
  const day = (at.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - day));
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

type B = { id: string; companyId: string; branchId: string | null; name: string; period: BudgetPeriod; amount: Prisma.Decimal | Decimal; categoryIds: Prisma.JsonValue; action: BudgetAction };
const cats = (b: B) => ((b.categoryIds as string[] | null) ?? []).filter(Boolean);

/** Spent in the budget's current period (incl. VAT). */
export async function spentFor(b: B, at = new Date()): Promise<Decimal> {
  const { start, end } = periodBounds(b.period, at);
  const c = cats(b);
  if (!c.length) {
    const r = await prisma.order.aggregate({ where: { buyerCompanyId: b.companyId, ...(b.branchId ? { branchId: b.branchId } : {}), placedAt: { gte: start, lt: end }, status: { not: "CANCELLED" } }, _sum: { grandTotal: true } });
    return new Decimal(r._sum.grandTotal?.toString() ?? 0);
  }
  const like = c.map((id) => `%/${id}/%`);
  const rows = await prisma.$queryRaw<{ s: Prisma.Decimal | null }[]>`
    SELECT SUM(l."lineNet" + l."lineVat") AS s
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    JOIN "VendorOffer" vo ON vo.id = l."offerId" JOIN "PackagingUnit" pp ON pp.id = vo."packagingUnitId"
    JOIN "ProductVariant" pv ON pv.id = pp."variantId" JOIN "Product" p ON p.id = pv."productId" JOIN "Category" c ON c.id = p."categoryId"
    WHERE o."buyerCompanyId" = ${b.companyId} AND o.status <> 'CANCELLED' AND o."placedAt" >= ${start} AND o."placedAt" < ${end}
      ${b.branchId ? Prisma.sql`AND o."branchId" = ${b.branchId}` : Prisma.empty}
      AND c.path LIKE ANY (${like}::text[])`;
  return new Decimal(rows[0]?.s?.toString() ?? 0);
}

async function applicable(companyId: string, branchId: string | null) {
  return prisma.budget.findMany({ where: { companyId, isActive: true, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] }, orderBy: { name: "asc" } });
}

export type BudgetCheck = { id: string; name: string; branchId: string | null; period: BudgetPeriod; action: BudgetAction; amount: string; spent: string; adding: string; projected: string; pct: number; exceeded: boolean };

/** What a checkout (lines incl. VAT with their category ids) does to the budgets of its branch. */
export async function evaluateBudgets(companyId: string, branchId: string | null, lines: { gross: Decimal.Value; categoryIds: string[] }[]): Promise<BudgetCheck[]> {
  const out: BudgetCheck[] = [];
  for (const b of await applicable(companyId, branchId)) {
    const c = cats(b);
    const adding = lines.filter((l) => !c.length || l.categoryIds.some((x) => c.includes(x))).reduce((a, l) => a.plus(l.gross), new Decimal(0));
    if (c.length && adding.isZero()) continue;
    const spent = await spentFor(b);
    const amount = new Decimal(b.amount.toString());
    const projected = spent.plus(adding);
    out.push({ id: b.id, name: b.name, branchId: b.branchId, period: b.period, action: b.action, amount: amount.toFixed(2), spent: spent.toFixed(2), adding: adding.toFixed(2), projected: projected.toFixed(2), pct: amount.isZero() ? 0 : projected.div(amount).mul(100).toDecimalPlaces(0).toNumber(), exceeded: projected.gt(amount) });
  }
  return out;
}

/** Lines of a priced checkout for the budget check: goods incl. VAT, delivery spread over them. */
export function checkoutLines(pc: { grandTotal: Decimal.Value; parts: { lines: { item: { categoryIds: string[] }; calc: { lineNet: Decimal.Value; lineVat: Decimal.Value } }[] }[] }) {
  const lines = pc.parts.flatMap((p) => p.lines.map((l) => ({ gross: new Decimal(l.calc.lineNet).plus(l.calc.lineVat), categoryIds: l.item.categoryIds })));
  const goods = lines.reduce((a, l) => a.plus(l.gross), new Decimal(0));
  const rest = new Decimal(pc.grandTotal).minus(goods); // delivery fees, discounts on the order
  if (!rest.isZero()) lines.push({ gross: rest, categoryIds: [] });
  return lines;
}

/** After an order: tell the managers once per period when a budget passes 80 % / 100 %. */
export async function budgetAlertsAfterOrder(companyId: string, branchId: string | null) {
  for (const b of await applicable(companyId, branchId)) {
    const spent = await spentFor(b);
    const amount = new Decimal(b.amount.toString());
    if (amount.isZero()) continue;
    const pct = spent.div(amount).mul(100).toNumber();
    const { start } = periodBounds(b.period);
    for (const level of [100, 80]) {
      if (pct < level) continue;
      const created = await prisma.budgetAlert.create({ data: { budgetId: b.id, periodStart: start, level } }).then(() => true).catch(() => false);
      if (!created) break; // already told for this level (and so for the lower one)
      const manager = b.branchId ? await prisma.branch.findUnique({ where: { id: b.branchId }, select: { manager: { select: { userId: true } } } }) : null;
      await notify("budget.threshold", [{ companyId, link: "/buy/branches/budgets" }, ...(manager?.manager ? [{ userId: manager.manager.userId, link: "/buy/branches/budgets" }] : [])],
        { name: b.name, pct: Math.round(pct), spent: spent.toFixed(2), amount: amount.toFixed(2) }, { ref: { type: "Budget", id: b.id } }).catch(() => null);
      break; // one message: the highest level reached
    }
  }
}

// ── management ──────────────────────────────────────────────────────────────

const isBuyerCo = (ctx: Ctx) => (ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER") && ctx.company.status === "APPROVED";

/** Budgets the caller can see, with this period's use. */
export async function listBudgets(ctx: Ctx) {
  if (!isBuyerCo(ctx) || !can(ctx, [MANAGE, "buyer.orders.place", "buyer.orders.view", "buyer.reports.view"])) throw new ForbiddenError();
  const s = await branchScope(ctx);
  const rows = await prisma.budget.findMany({ where: { companyId: ctx.company.id, ...(s ? { OR: [{ branchId: { in: s } }, { branchId: null }] } : {}) }, include: { branch: { select: { name: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  const out = [];
  for (const b of rows) {
    const spent = await spentFor(b);
    const amount = new Decimal(b.amount.toString());
    const { start, end } = periodBounds(b.period);
    out.push({ id: b.id, name: b.name, branchId: b.branchId, branch: b.branch?.name ?? null, period: b.period, action: b.action, isActive: b.isActive, categoryIds: cats(b), amount: amount.toFixed(2), spent: spent.toFixed(2), pct: amount.isZero() ? 0 : spent.div(amount).mul(100).toDecimalPlaces(0).toNumber(), periodStart: start, periodEnd: new Date(end.getTime() - 86_400_000) });
  }
  return out;
}

export type BudgetInput = { name: string; branchId: string | null; period: BudgetPeriod; amount: number; categoryIds: string[]; action: BudgetAction; isActive?: boolean };
export async function saveBudget(ctx: Ctx, id: string | null, i: BudgetInput) {
  if (!isBuyerCo(ctx) || !can(ctx, MANAGE)) throw new ForbiddenError();
  const name = i.name.trim();
  if (!name) throw new ValidationError("Give the budget a name.");
  if (!(i.amount > 0) || i.amount > 100_000_000) throw new ValidationError("The budget amount must be above 0.");
  if (i.branchId && !(await prisma.branch.count({ where: { id: i.branchId, companyId: ctx.company.id } }))) throw new NotFoundError("Branch");
  if (i.categoryIds.length > 50) throw new ValidationError("At most 50 categories.");
  if (i.categoryIds.length && (await prisma.category.count({ where: { id: { in: i.categoryIds } } })) !== i.categoryIds.length) throw new ValidationError("Unknown category.");
  const data = { name, branchId: i.branchId, period: i.period, amount: new Decimal(i.amount).toFixed(2), categoryIds: i.categoryIds, action: i.action, isActive: i.isActive ?? true };
  let row;
  if (id) {
    if (!(await prisma.budget.count({ where: { id, companyId: ctx.company.id } }))) throw new NotFoundError("Budget");
    row = await prisma.budget.update({ where: { id }, data });
  } else row = await prisma.budget.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: id ? "budget.updated" : "budget.created", entityType: "Budget", entityId: row.id, after: data });
  return row.id;
}

export async function deleteBudget(ctx: Ctx, id: string) {
  if (!isBuyerCo(ctx) || !can(ctx, MANAGE)) throw new ForbiddenError();
  const r = await prisma.budget.deleteMany({ where: { id, companyId: ctx.company.id } });
  if (!r.count) throw new NotFoundError("Budget");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "budget.deleted", entityType: "Budget", entityId: id });
}

/** Cart: what the current cart would do to the budgets of the branch of this delivery address. */
export async function budgetPreview(ctx: Ctx, addressId: string) {
  if (!isBuyerCo(ctx)) return [];
  const a = await prisma.address.findFirst({ where: { id: addressId, companyId: ctx.company.id }, select: { id: true, branchId: true, city: { select: { regionId: true } } } });
  if (!a) return [];
  if (!(await prisma.budget.count({ where: { companyId: ctx.company.id, isActive: true } }))) return [];
  const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: true } });
  if (!cart?.items.length) return evaluateBudgets(ctx.company.id, a.branchId, []);
  const { priceCheckout } = await import("@/server/orders/pricing");
  const pc = await priceCheckout(ctx, { items: cart.items.map((x) => ({ offerId: x.offerId, qty: x.qty })), couponCode: cart.couponCode }, { regionId: a.city?.regionId ?? null, addressId: a.id });
  return evaluateBudgets(ctx.company.id, a.branchId, checkoutLines(pc));
}
