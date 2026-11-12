/**
 * The company's own accounting (Phase 27, optional — FIRINGI switches it on per company): the day's
 * sales (cash, card, delivery apps, other) and expenses (rent, utilities, salaries, social security,
 * other suppliers…), with a receipt photo, and fixed monthly expenses added automatically. Purchases
 * on FIRINGI and sales through FIRINGI come in by themselves (see pnl.ts). Amounts incl. VAT; the VAT
 * rate is optional. FIRINGI staff never see this data.
 */
import Decimal from "decimal.js";
import type { AccountingCategory, AccountingKind, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { CompanyFeatureOffError, companyFeatureOn } from "./features";

export const SALE_CATEGORIES = ["SALES_CASH", "SALES_CARD", "SALES_DELIVERY_APPS", "SALES_OTHER"] as const satisfies readonly AccountingCategory[];
export const EXPENSE_CATEGORIES = [
  "OTHER_SUPPLIERS", "RENT", "ELECTRICITY", "WATER", "GAS", "TELECOM", "SALARIES", "SOCIAL_SECURITY", "INSURANCE", "MAINTENANCE", "MARKETING", "BANK_FEES", "TAXES_FEES", "ACCOUNTANT", "TRANSPORT", "OTHER",
] as const satisfies readonly AccountingCategory[];
export const kindOf = (c: AccountingCategory): AccountingKind => ((SALE_CATEGORIES as readonly string[]).includes(c) ? "SALE" : "EXPENSE");

const ACC_TYPES = ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"];
const hasBranches = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";

/** Guard: approved supplier / customer, FIRINGI switched accounting on, the right permission. */
export async function requireAccounting(ctx: Ctx, manage = false) {
  if (!ACC_TYPES.includes(ctx.company.type) || ctx.company.status !== "APPROVED") throw new ForbiddenError();
  if (!can(ctx, manage ? "company.accounting.manage" : ["company.accounting.view", "company.accounting.manage"])) throw new ForbiddenError();
  if (!(await companyFeatureOn(ctx.company.id, "ACCOUNTING"))) throw new CompanyFeatureOffError();
}

/** Branch staff only work with their branches' figures (company-level entries are for head office). */
export async function accountingScope(ctx: Ctx): Promise<string[] | null> {
  if (!hasBranches(ctx)) return null;
  const { branchScope } = await import("@/server/multisite/branches");
  return branchScope(ctx);
}

/** `branch`: undefined = everything the caller sees; "NONE" = company level only; an id = that branch. */
export async function entryWhere(ctx: Ctx, branch?: string | null): Promise<Prisma.AccountingEntryWhereInput> {
  const s = await accountingScope(ctx);
  if (branch === "NONE") return s ? { id: "-" } : { companyId: ctx.company.id, branchId: null };
  if (branch) {
    if (s && !s.includes(branch)) return { id: "-" };
    return { companyId: ctx.company.id, branchId: branch };
  }
  return { companyId: ctx.company.id, ...(s ? { branchId: { in: s } } : {}) };
}

async function checkBranch(ctx: Ctx, branchId: string | null | undefined) {
  if (!branchId) {
    if (await accountingScope(ctx)) throw new ValidationError("Choose one of your branches.");
    return null;
  }
  if (!hasBranches(ctx)) throw new ValidationError("Unknown branch.");
  const s = await accountingScope(ctx);
  if (s && !s.includes(branchId)) throw new ForbiddenError();
  if (!(await prisma.branch.count({ where: { id: branchId, companyId: ctx.company.id } }))) throw new NotFoundError("Branch");
  return branchId;
}

const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
function checkDate(d: Date) {
  if (Number.isNaN(d.getTime())) throw new ValidationError("Choose a date.");
  const today = day(new Date());
  if (d.getTime() > today.getTime() + 86_400_000) throw new ValidationError("The date can't be in the future.");
  if (d.getUTCFullYear() < 2000) throw new ValidationError("Choose a later date.");
  return day(d);
}
function checkAmount(a: number) {
  if (!Number.isFinite(a) || a <= 0 || a > 10_000_000) throw new ValidationError("Enter an amount above 0.");
  return new Decimal(a).toDecimalPlaces(2);
}
function checkVat(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (v < 0 || v > 30) throw new ValidationError("VAT rate: 0–30 %.");
  return new Decimal(v).toDecimalPlaces(2);
}

export type EntryInput = { category: AccountingCategory; date: Date; amount: number; vatRate?: number | null; branchId?: string | null; payee?: string | null; description?: string | null };

export async function listEntries(ctx: Ctx, f: { from: Date; to: Date; kind?: AccountingKind; branch?: string | null; category?: AccountingCategory }) {
  await requireAccounting(ctx);
  const rows = await prisma.accountingEntry.findMany({
    where: { AND: [await entryWhere(ctx, f.branch), { date: { gte: day(f.from), lte: day(f.to) } }, f.kind ? { kind: f.kind } : {}, f.category ? { category: f.category } : {}] },
    include: { branch: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 2000,
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id, kind: r.kind, category: r.category, date: r.date, amount: r.amount.toString(), vatRate: r.vatRate?.toString() ?? null, branchId: r.branchId, branch: r.branch?.name ?? null,
    payee: r.payee, description: r.description, hasReceipt: !!r.receiptKey, recurring: !!r.recurringId, createdBy: users.find((u) => u.id === r.createdById)?.name ?? null,
  }));
}

export async function addEntry(ctx: Ctx, i: EntryInput, receipt?: File | null) {
  await requireAccounting(ctx, true);
  const branchId = await checkBranch(ctx, i.branchId);
  const stored = receipt && receipt.size ? await (await import("@/server/services/storage")).storeUpload(receipt, `accounting/${ctx.company.id}`) : null;
  const e = await prisma.accountingEntry.create({
    data: {
      companyId: ctx.company.id, branchId, kind: kindOf(i.category), category: i.category, date: checkDate(i.date), amount: checkAmount(i.amount).toFixed(2), vatRate: checkVat(i.vatRate)?.toFixed(2) ?? null,
      payee: i.payee?.trim().slice(0, 120) || null, description: i.description?.trim().slice(0, 500) || null, createdById: ctx.user.id,
      ...(stored ? { receiptKey: stored.key, receiptName: stored.fileName, receiptMime: stored.mimeType } : {}),
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "accounting.entry_added", entityType: "AccountingEntry", entityId: e.id, after: { category: i.category, amount: e.amount.toString(), date: e.date } });
  return e.id;
}

async function ownEntry(ctx: Ctx, id: string) {
  const e = await prisma.accountingEntry.findFirst({ where: { id, ...(await entryWhere(ctx)) } });
  if (!e) throw new NotFoundError("Entry");
  return e;
}

export async function updateEntry(ctx: Ctx, id: string, i: EntryInput) {
  await requireAccounting(ctx, true);
  await ownEntry(ctx, id);
  const branchId = await checkBranch(ctx, i.branchId);
  await prisma.accountingEntry.update({
    where: { id }, data: { branchId, kind: kindOf(i.category), category: i.category, date: checkDate(i.date), amount: checkAmount(i.amount).toFixed(2), vatRate: checkVat(i.vatRate)?.toFixed(2) ?? null, payee: i.payee?.trim().slice(0, 120) || null, description: i.description?.trim().slice(0, 500) || null },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "accounting.entry_updated", entityType: "AccountingEntry", entityId: id, after: { category: i.category, amount: i.amount } });
}

export async function deleteEntry(ctx: Ctx, id: string) {
  await requireAccounting(ctx, true);
  const e = await ownEntry(ctx, id);
  await prisma.accountingEntry.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "accounting.entry_deleted", entityType: "AccountingEntry", entityId: id, before: { category: e.category, amount: e.amount.toString(), date: e.date } });
}

/** A receipt the caller may see. */
export async function entryReceipt(ctx: Ctx, id: string) {
  await requireAccounting(ctx);
  const e = await ownEntry(ctx, id);
  if (!e.receiptKey) throw new NotFoundError("Receipt");
  const { readStored } = await import("@/server/services/storage");
  return { body: await readStored(e.receiptKey), mime: e.receiptMime ?? "application/octet-stream", name: e.receiptName ?? "receipt" };
}

/**
 * The day's close: sales per payment method for a day (and branch). Saving the same day again
 * replaces that day's figures; a method left at 0 is removed.
 */
export async function saveDailySales(ctx: Ctx, i: { date: Date; branchId?: string | null; vatRate?: number | null; cash?: number; card?: number; deliveryApps?: number; other?: number; note?: string | null }) {
  await requireAccounting(ctx, true);
  const branchId = await checkBranch(ctx, i.branchId);
  const date = checkDate(i.date);
  const vat = checkVat(i.vatRate);
  const parts: [AccountingCategory, number | undefined][] = [["SALES_CASH", i.cash], ["SALES_CARD", i.card], ["SALES_DELIVERY_APPS", i.deliveryApps], ["SALES_OTHER", i.other]];
  for (const [, v] of parts) if (v !== undefined && v !== null && (!Number.isFinite(v) || v < 0 || v > 10_000_000)) throw new ValidationError("Amounts must be 0 or more.");
  if (!parts.some(([, v]) => (v ?? 0) > 0)) throw new ValidationError("Enter at least one amount.");
  await prisma.$transaction(async (tx) => {
    await tx.accountingEntry.deleteMany({ where: { companyId: ctx.company.id, branchId, date, category: { in: SALE_CATEGORIES as unknown as AccountingCategory[] }, recurringId: null } });
    for (const [category, v] of parts) {
      if (!v || v <= 0) continue;
      await tx.accountingEntry.create({ data: { companyId: ctx.company.id, branchId, kind: "SALE", category, date, amount: new Decimal(v).toFixed(2), vatRate: vat?.toFixed(2) ?? null, description: i.note?.trim().slice(0, 500) || null, createdById: ctx.user.id } });
    }
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "accounting.daily_sales", entityType: "Company", entityId: ctx.company.id, after: { date, branchId, cash: i.cash ?? 0, card: i.card ?? 0, deliveryApps: i.deliveryApps ?? 0, other: i.other ?? 0 } });
}

/** The day's figures already saved (to fill the daily-close form). */
export async function dailySales(ctx: Ctx, date: Date, branchId: string | null) {
  await requireAccounting(ctx);
  const rows = await prisma.accountingEntry.findMany({ where: { AND: [await entryWhere(ctx, branchId ?? "NONE"), { date: day(date), kind: "SALE" }] } });
  const sum = (c: AccountingCategory) => rows.filter((r) => r.category === c).reduce((a, r) => a.plus(r.amount.toString()), new Decimal(0)).toNumber();
  return { cash: sum("SALES_CASH"), card: sum("SALES_CARD"), deliveryApps: sum("SALES_DELIVERY_APPS"), other: sum("SALES_OTHER"), vatRate: rows.find((r) => r.vatRate)?.vatRate?.toNumber() ?? null };
}

// ── fixed monthly expenses ──────────────────────────────────────────────────

export type RecurringExpenseInput = { category: AccountingCategory; amount: number; vatRate?: number | null; branchId?: string | null; payee?: string | null; description?: string | null; dayOfMonth: number; startsOn: Date; endsOn?: Date | null };

export async function listRecurringExpenses(ctx: Ctx) {
  await requireAccounting(ctx);
  const s = await accountingScope(ctx);
  const rows = await prisma.recurringExpense.findMany({ where: { companyId: ctx.company.id, ...(s ? { branchId: { in: s } } : {}) }, include: { branch: { select: { name: true } }, _count: { select: { entries: true } } }, orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }] });
  return rows.map((r) => ({ id: r.id, category: r.category, amount: r.amount.toString(), vatRate: r.vatRate?.toString() ?? null, branch: r.branch?.name ?? null, branchId: r.branchId, payee: r.payee, description: r.description, dayOfMonth: r.dayOfMonth, startsOn: r.startsOn, endsOn: r.endsOn, isActive: r.isActive, entries: r._count.entries }));
}

export async function saveRecurringExpense(ctx: Ctx, id: string | null, i: RecurringExpenseInput) {
  await requireAccounting(ctx, true);
  if (kindOf(i.category) !== "EXPENSE") throw new ValidationError("Choose an expense category.");
  if (!Number.isInteger(i.dayOfMonth) || i.dayOfMonth < 1 || i.dayOfMonth > 28) throw new ValidationError("Day of the month: 1–28.");
  const branchId = await checkBranch(ctx, i.branchId);
  const startsOn = day(i.startsOn);
  if (Number.isNaN(startsOn.getTime())) throw new ValidationError("Choose a start date.");
  const endsOn = i.endsOn ? day(i.endsOn) : null;
  if (endsOn && endsOn < startsOn) throw new ValidationError("The end date must be after the start.");
  const data = { category: i.category, amount: checkAmount(i.amount).toFixed(2), vatRate: checkVat(i.vatRate)?.toFixed(2) ?? null, branchId, payee: i.payee?.trim().slice(0, 120) || null, description: i.description?.trim().slice(0, 500) || null, dayOfMonth: i.dayOfMonth, startsOn, endsOn };
  let rowId: string;
  if (id) {
    if (!(await prisma.recurringExpense.count({ where: { id, companyId: ctx.company.id } }))) throw new NotFoundError("Recurring expense");
    rowId = (await prisma.recurringExpense.update({ where: { id }, data })).id;
  } else rowId = (await prisma.recurringExpense.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } })).id;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: id ? "accounting.recurring_updated" : "accounting.recurring_added", entityType: "RecurringExpense", entityId: rowId, after: data });
  await runRecurringExpenses(new Date(), rowId);
  return rowId;
}

export async function setRecurringExpenseActive(ctx: Ctx, id: string, active: boolean) {
  await requireAccounting(ctx, true);
  const r = await prisma.recurringExpense.updateMany({ where: { id, companyId: ctx.company.id }, data: { isActive: active } });
  if (!r.count) throw new NotFoundError("Recurring expense");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: active ? "accounting.recurring_resumed" : "accounting.recurring_stopped", entityType: "RecurringExpense", entityId: id });
  if (active) await runRecurringExpenses(new Date(), id);
}

/** Job (and on save): add each fixed expense on its day — this month and up to 11 months back from its start. */
export async function runRecurringExpenses(now = new Date(), onlyId?: string) {
  const today = day(now);
  const rows = await prisma.recurringExpense.findMany({ where: { isActive: true, ...(onlyId ? { id: onlyId } : {}), startsOn: { lte: today }, company: { features: { some: { key: "ACCOUNTING", enabled: true } } } } });
  let added = 0;
  for (const r of rows) {
    let last: Date | null = null;
    for (let back = 11; back >= 0; back--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, r.dayOfMonth));
      if (d < r.startsOn || d > today || (r.endsOn && d > r.endsOn)) continue;
      if (r.generatedThrough && d <= r.generatedThrough) continue;
      last = d;
      const created = await prisma.accountingEntry.create({
        data: { companyId: r.companyId, branchId: r.branchId, kind: "EXPENSE", category: r.category, date: d, amount: r.amount, vatRate: r.vatRate, payee: r.payee, description: r.description, recurringId: r.id, createdById: r.createdById },
      }).then(() => true).catch(() => false); // unique (recurringId, date): already there
      if (created) added++;
    }
    if (last) await prisma.recurringExpense.update({ where: { id: r.id }, data: { generatedThrough: last } });
  }
  return { added };
}
