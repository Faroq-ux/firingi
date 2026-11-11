/**
 * Supplier payouts — paid by hand (bank transfer), FIRINGI only keeps the list straight:
 * approved supplier invoices with money still open, each with its due date (the supplier's own,
 * else its date + the policy's payout days), grouped by supplier; a daily reminder to finance.
 * Recording the payout goes through recordPayment (four-eyes for big amounts).
 */
import "server-only";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { paymentPolicy } from "./payments";

const DAY = 86400_000;
const REMIND_KEY = "payouts.reminded";

export type DuePayout = { id: string; vendorId: string; vendor: string; vendorType: string; number: string; issueDate: string; dueDate: string; daysLeft: number; open: number; gross: number };

async function dueRows(now: Date): Promise<DuePayout[]> {
  const days = (await paymentPolicy()).supplierPayoutDays;
  const rows = await prisma.vendorInvoice.findMany({
    where: { status: "APPROVED", docType: { not: "CREDIT_NOTE" } },
    include: { vendor: { select: { id: true, legalName: true, tradeName: true, type: true } } },
    orderBy: { issueDate: "asc" },
  });
  const paid = await prisma.paymentAllocation.groupBy({ by: ["vendorInvoiceId"], where: { vendorInvoiceId: { in: rows.map((r) => r.id) }, payment: { status: "CONFIRMED" } }, _sum: { amount: true } });
  const pm = new Map(paid.map((p) => [p.vendorInvoiceId!, new Decimal(p._sum.amount?.toString() ?? 0)]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return rows.map((r) => {
    const due = r.dueDate ?? new Date(r.issueDate.getTime() + days * DAY);
    const open = new Decimal(r.grossTotal.toString()).minus(pm.get(r.id) ?? 0);
    return {
      id: r.id, vendorId: r.vendor.id, vendor: r.vendor.tradeName ?? r.vendor.legalName, vendorType: r.vendor.type, number: r.externalNumber,
      issueDate: r.issueDate.toISOString().slice(0, 10), dueDate: due.toISOString().slice(0, 10), daysLeft: Math.round((due.getTime() - today) / DAY), open: open.toNumber(), gross: Number(r.grossTotal),
    };
  }).filter((r) => r.open > 0.004).sort((a, b) => a.daysLeft - b.daysLeft);
}

/** What to pay, soonest first: overdue, due within `withinDays`, later. */
export async function duePayouts(ctx: Ctx, opts: { withinDays?: number; now?: Date } = {}) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError();
  const within = opts.withinDays ?? 7;
  const rows = await dueRows(opts.now ?? new Date());
  const sum = (xs: DuePayout[]) => Math.round(xs.reduce((a, r) => a + r.open, 0) * 100) / 100;
  const overdue = rows.filter((r) => r.daysLeft < 0), soon = rows.filter((r) => r.daysLeft >= 0 && r.daysLeft <= within), later = rows.filter((r) => r.daysLeft > within);
  const bySupplier = new Map<string, { vendorId: string; vendor: string; count: number; open: number; overdue: number; nextDue: string }>();
  for (const r of [...overdue, ...soon]) {
    const g = bySupplier.get(r.vendorId) ?? { vendorId: r.vendorId, vendor: r.vendor, count: 0, open: 0, overdue: 0, nextDue: r.dueDate };
    g.count++; g.open = Math.round((g.open + r.open) * 100) / 100; if (r.daysLeft < 0) g.overdue = Math.round((g.overdue + r.open) * 100) / 100;
    if (r.dueDate < g.nextDue) g.nextDue = r.dueDate;
    bySupplier.set(r.vendorId, g);
  }
  return { rows, overdue, soon, later, totals: { overdue: sum(overdue), soon: sum(soon), later: sum(later) }, bySupplier: [...bySupplier.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open), withinDays: within };
}

/** CSV of what is due (overdue + within the window) for the bank or the accountant. */
export async function duePayoutsCsv(ctx: Ctx, withinDays = 7) {
  const d = await duePayouts(ctx, { withinDays });
  const esc = (v: string | number) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const vendorIds = [...new Set([...d.overdue, ...d.soon].map((r) => r.vendorId))];
  const nif = new Map((await prisma.company.findMany({ where: { id: { in: vendorIds } }, select: { id: true, taxId: true, legalName: true } })).map((c) => [c.id, c]));
  const lines = [["Supplier", "NIF / VAT", "Invoice", "Invoice date", "Due date", "Days", "Open amount (EUR)"].join(";")];
  for (const r of [...d.overdue, ...d.soon]) lines.push([esc(nif.get(r.vendorId)?.legalName ?? r.vendor), esc(nif.get(r.vendorId)?.taxId ?? ""), esc(r.number), r.issueDate, r.dueDate, String(r.daysLeft), r.open.toFixed(2).replace(".", ",")].join(";"));
  return lines.join("\n") + "\n";
}

/** Once a day: tell finance what is overdue or due in the next 3 days. */
export async function remindDuePayouts(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const last = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: REMIND_KEY } });
  if ((last?.value as { day?: string } | null)?.day === today) return { sent: false, reason: "already today" };
  const rows = (await dueRows(now)).filter((r) => r.daysLeft <= 3);
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: REMIND_KEY } }, update: { value: { day: today } }, create: { scope: "GLOBAL", key: REMIND_KEY, value: { day: today } } });
  if (!rows.length) return { sent: false, reason: "nothing due" };
  const amount = rows.reduce((a, r) => a + r.open, 0);
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  if (!admin) return { sent: false, reason: "no admin company" };
  const { notify } = await import("@/server/notify/dispatch");
  const r = await notify("payout.due", [{ companyId: admin.id, link: "/admin/finance/payouts-due" }], {
    count: String(rows.length), amount: new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(amount), overdue: String(rows.filter((x) => x.daysLeft < 0).length),
  });
  return { sent: true, count: rows.length, amount: Math.round(amount * 100) / 100, recipients: r.recipients };
}
