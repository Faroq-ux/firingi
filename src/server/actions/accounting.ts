"use server";
/** The company's own accounting (Phase 27, optional per company). */
import { z } from "zod";
import type { AccountingCategory } from "@prisma/client";
import { defineAction, runAction } from "./_action";
import { addEntry, deleteEntry, saveDailySales, saveRecurringExpense, setRecurringExpenseActive, updateEntry, dailySales, EXPENSE_CATEGORIES, SALE_CATEGORIES } from "@/server/accounting/entries";
import { ValidationError } from "@/server/errors";

const id = z.string().min(1).max(40);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const M = "company.accounting.manage" as const;
const CATS = [...SALE_CATEGORIES, ...EXPENSE_CATEGORIES] as [AccountingCategory, ...AccountingCategory[]];
const amount = z.number().min(0).max(10_000_000);
const vat = z.number().min(0).max(30).nullable().optional();
const opt = (n: number) => z.string().max(n).nullable().optional();
const entry = z.object({ category: z.enum(CATS), date: isoDate, amount: z.number().positive().max(10_000_000), vatRate: vat, branchId: id.nullable().optional(), payee: opt(120), description: opt(500) });

export const saveDailySalesAction = defineAction({
  permission: M, schema: z.object({ date: isoDate, branchId: id.nullable().optional(), vatRate: vat, cash: amount.optional(), card: amount.optional(), deliveryApps: amount.optional(), other: amount.optional(), note: opt(500) }),
  handler: async (ctx, i) => { await saveDailySales(ctx, { ...i, date: date(i.date) }); return true; },
});
export const dailySalesAction = defineAction({
  permission: ["company.accounting.view", M], schema: z.object({ date: isoDate, branchId: id.nullable().optional() }),
  handler: async (ctx, i) => dailySales(ctx, date(i.date), i.branchId ?? null),
});
export const updateEntryAction = defineAction({ permission: M, schema: entry.extend({ id }), handler: async (ctx, i) => { await updateEntry(ctx, i.id, { ...i, date: date(i.date) }); return true; } });
export const deleteEntryAction = defineAction({ permission: M, schema: z.object({ id }), handler: async (ctx, i) => { await deleteEntry(ctx, i.id); return true; } });

/** An expense (or sale) with an optional receipt photo / PDF (FormData). */
export async function addEntryAction(fd: FormData) {
  return runAction(async (ctx) => {
    const s = (k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
    const n = (k: string) => { const v = s(k); return v === null ? null : Number(v.replace(",", ".")); };
    const parsed = entry.safeParse({ category: s("category"), date: s("date"), amount: n("amount"), vatRate: n("vatRate"), branchId: s("branchId"), payee: s("payee"), description: s("description") });
    if (!parsed.success) throw new ValidationError("Check the date, category and amount.");
    const file = fd.get("receipt");
    return addEntry(ctx, { ...parsed.data, date: date(parsed.data.date) }, file instanceof File && file.size > 0 ? file : null);
  });
}

export const saveRecurringExpenseAction = defineAction({
  permission: M,
  schema: z.object({ id: id.nullable().optional(), category: z.enum(CATS), amount: z.number().positive().max(10_000_000), vatRate: vat, branchId: id.nullable().optional(), payee: opt(120), description: opt(500), dayOfMonth: z.number().int().min(1).max(28), startsOn: isoDate, endsOn: isoDate.nullable().optional() }),
  handler: async (ctx, i) => saveRecurringExpense(ctx, i.id ?? null, { ...i, startsOn: date(i.startsOn), endsOn: i.endsOn ? date(i.endsOn) : null }),
});
export const setRecurringExpenseActiveAction = defineAction({ permission: M, schema: z.object({ id, active: z.boolean() }), handler: async (ctx, i) => { await setRecurringExpenseActive(ctx, i.id, i.active); return true; } });
