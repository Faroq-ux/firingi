/**
 * Payments job (/api/cron/payments, every 5 minutes):
 *  1. expire unused payment requests;
 *  2. ask the provider about attempts in progress when it has no webhook for them (MB WAY
 *     approval in the simulator, direct debit settlement);
 *  3. direct debit: tell the customer N days before (SEPA pre-notification), then collect each
 *     invoice on its due date from the signed mandate;
 *  4. reminders: before the due date, on it, and when overdue (each once per invoice, daytime only),
 *     with a pay link;
 *  5. cancel pay-before-shipping orders left unpaid for too long;
 *  6. use leftover customer credit on open invoices.
 */
import "server-only";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { notify } from "@/server/notify/dispatch";
import { paymentPolicy } from "@/server/services/payments";
import { applyCustomerCredit, collectDue, createRequest, customerCredit, openAmounts, pollRequest } from "./service";

const DAY = 86400_000;
const ZERO = new Decimal(0);

type OpenInvoice = { id: string; companyId: string; number: string; dueAt: Date; open: Decimal };

async function openInvoicesDueBefore(limit: Date): Promise<OpenInvoice[]> {
  const rows = await prisma.invoice.findMany({
    where: { docType: { in: ["INVOICE", "INVOICE_RECEIPT"] }, status: { not: "DRAFT" }, dueAt: { not: null, lte: limit }, recipient: { type: { in: ["CUSTOMER", "WHOLESALER"] } } },
    select: { id: true, recipientCompanyId: true, fullNumber: true, providerNumber: true, dueAt: true },
    orderBy: { dueAt: "asc" },
    take: 2000,
  });
  const open = await openAmounts(rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, companyId: r.recipientCompanyId, number: r.providerNumber ?? r.fullNumber ?? "?", dueAt: r.dueAt!, open: open.get(r.id) ?? ZERO })).filter((r) => r.open.gt(0.004));
}

async function inProgress(invoiceIds: string[]) {
  const rows = await prisma.paymentRequestItem.findMany({ where: { invoiceId: { in: invoiceIds }, request: { status: "PROCESSING" } }, select: { invoiceId: true } });
  return new Set(rows.map((r) => r.invoiceId));
}

async function remindersSent(invoiceIds: string[]) {
  const rows = await prisma.invoiceReminder.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { invoiceId: true, kind: true, sentAt: true } });
  const m = new Map<string, Map<string, Date>>();
  for (const r of rows) (m.get(r.invoiceId) ?? m.set(r.invoiceId, new Map()).get(r.invoiceId)!).set(r.kind, r.sentAt);
  return m;
}

const byCompany = <T extends { companyId: string }>(xs: T[]) => xs.reduce((m, x) => m.set(x.companyId, [...(m.get(x.companyId) ?? []), x]), new Map<string, T[]>());
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

export async function processPayments(now = new Date()) {
  const policy = await paymentPolicy();
  const out = { expired: 0, polled: 0, ddNotices: 0, ddCollections: 0, reminders: 0, unpaidCancelled: 0, creditApplied: 0 };

  // 1. expire
  out.expired = (await prisma.paymentRequest.updateMany({ where: { status: "OPEN", expiresAt: { lt: now } }, data: { status: "EXPIRED" } })).count;
  out.expired += (await prisma.paymentRequest.updateMany({ where: { status: "PROCESSING", method: { not: "DIRECT_DEBIT" }, expiresAt: { lt: now } }, data: { status: "EXPIRED" } })).count;

  // 2. poll attempts in progress
  const busy = await prisma.paymentRequest.findMany({ where: { status: "PROCESSING" }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 100 });
  for (const r of busy) { await pollRequest(r.id).catch(() => null); out.polled++; }

  // 3. direct debit
  const mandates = await prisma.sepaMandate.findMany({ where: { status: "ACTIVE", autoCollect: true }, select: { id: true, companyId: true } });
  const ddCompanies = new Set(mandates.map((m) => m.companyId));
  const horizon = new Date(now.getTime() + policy.online.directDebitNoticeDays * DAY);
  const soonDue = (await openInvoicesDueBefore(new Date(now.getTime() + Math.max(policy.online.directDebitNoticeDays, policy.online.reminderDaysBefore ?? 0) * DAY + DAY)));
  const busyInv = await inProgress(soonDue.map((i) => i.id));
  const sent = await remindersSent(soonDue.map((i) => i.id));
  const dd = soonDue.filter((i) => ddCompanies.has(i.companyId) && !busyInv.has(i.id));
  for (const [companyId, invs] of byCompany(dd)) {
    // Pre-notification for what will be collected within the notice period.
    const toNotify = invs.filter((i) => i.dueAt <= horizon && !sent.get(i.id)?.has("dd-notice"));
    if (toNotify.length) {
      const total = toNotify.reduce((a, i) => a.plus(i.open), ZERO);
      const date = new Date(Math.max(now.getTime() + policy.online.directDebitNoticeDays * DAY, Math.min(...toNotify.map((i) => i.dueAt.getTime()))));
      await notify("direct_debit.notice", [{ companyId, link: "/buy/finance/direct-debit" }], { total: total.toNumber(), documents: toNotify.map((i) => i.number).join(", "), date: fmtDate(date) });
      await prisma.invoiceReminder.createMany({ data: toNotify.map((i) => ({ invoiceId: i.id, kind: "dd-notice" })), skipDuplicates: true });
      out.ddNotices++;
      for (const i of toNotify) (sent.get(i.id) ?? sent.set(i.id, new Map()).get(i.id)!).set("dd-notice", now);
    }
    // Collect what is due and was announced long enough ago.
    const due = invs.filter((i) => i.dueAt <= now && (sent.get(i.id)?.get("dd-notice")?.getTime() ?? Infinity) <= now.getTime() - policy.online.directDebitNoticeDays * DAY + 60_000);
    if (due.length) {
      const ok = await collectDue(companyId, due.map((i) => i.id)).catch(() => null);
      if (ok) out.ddCollections++;
    }
  }

  // 4. reminders (daytime in Portugal/Europe: 08:00–19:59 UTC)
  const hour = now.getUTCHours();
  if (hour >= 8 && hour < 20) {
    const overdueMax = Math.max(0, ...policy.online.reminderOverdueDays);
    const candidates = await openInvoicesDueBefore(new Date(now.getTime() + (policy.online.reminderDaysBefore ?? 0) * DAY));
    const busy2 = await inProgress(candidates.map((i) => i.id));
    const sent2 = await remindersSent(candidates.map((i) => i.id));
    const due: { kind: string; inv: OpenInvoice; days: number }[] = [];
    for (const inv of candidates) {
      if (ddCompanies.has(inv.companyId) || busy2.has(inv.id)) continue; // collected by direct debit / being paid
      const s = sent2.get(inv.id) ?? new Map();
      const daysLate = Math.floor((now.getTime() - inv.dueAt.getTime()) / DAY);
      if (daysLate < 0) { if (policy.online.reminderDaysBefore !== null && !s.has("soon")) due.push({ kind: "soon", inv, days: -daysLate }); continue; }
      if (daysLate === 0) { if (policy.online.reminderOnDue && !s.has("due")) due.push({ kind: "due", inv, days: 0 }); continue; }
      // Overdue: the latest step reached that wasn't sent yet (earlier missed steps are skipped).
      const step = [...policy.online.reminderOverdueDays].reverse().find((d) => daysLate >= d);
      if (step && !s.has(`overdue-${step}`) && daysLate <= overdueMax + 60) due.push({ kind: `overdue-${step}`, inv, days: daysLate });
    }
    for (const [companyId, list] of byCompany(due.map((d) => ({ ...d, companyId: d.inv.companyId })))) {
      for (const kind of [...new Set(list.map((l) => l.kind))]) {
        const items = list.filter((l) => l.kind === kind);
        const req = await createRequest({ companyId, invoiceIds: items.map((i) => i.inv.id), source: "REMINDER" }).catch(() => null);
        if (!req) continue;
        const total = Number(req.amount);
        const documents = items.map((i) => i.inv.number).join(", ");
        const link = `/pay/${req.token}`;
        if (kind === "soon") await notify("payment.reminder_soon", [{ companyId, link }], { total, documents, due: fmtDate(items[0].inv.dueAt) }, { ref: { type: "PaymentRequest", id: req.id } });
        else if (kind === "due") await notify("payment.reminder_due", [{ companyId, link }], { total, documents }, { ref: { type: "PaymentRequest", id: req.id } });
        else await notify("payment.reminder_overdue", [{ companyId, link }], { total, documents, days: Math.max(...items.map((i) => i.days)) }, { ref: { type: "PaymentRequest", id: req.id } });
        await prisma.invoiceReminder.createMany({ data: items.map((i) => ({ invoiceId: i.inv.id, kind })), skipDuplicates: true });
        out.reminders++;
      }
    }
  }

  // 5. pay-before-shipping orders never paid
  const cutoff = new Date(now.getTime() - policy.online.prepayCancelDays * DAY);
  const stale = await prisma.order.findMany({ where: { status: "ON_HOLD", awaitingPayment: true, placedAt: { lt: cutoff }, paymentRequests: { none: { status: { in: ["PROCESSING", "PAID"] } } } }, include: { lines: { select: { id: true, qtyOrdered: true, qtyConfirmed: true } } }, take: 100 });
  if (stale.length) {
    const { applyOrderTransition } = await import("@/server/services/orders");
    for (const o of stale) {
      const ok = await prisma.$transaction(async (tx) => { await applyOrderTransition(tx, o, "CANCELLED", { reason: `Not paid within ${policy.online.prepayCancelDays} days`, userId: null, companyId: null }); return true; }).catch(() => false);
      if (!ok) continue;
      await prisma.paymentRequest.updateMany({ where: { orderId: o.id, status: { in: ["OPEN", "FAILED"] } }, data: { status: "CANCELLED" } });
      await notify("order.cancelled_unpaid", [{ companyId: o.buyerCompanyId, link: `/buy/orders/${o.id}` }], { number: o.number }, { ref: { type: "Order", id: o.id } });
      out.unpaidCancelled++;
    }
  }

  // 6. leftover credit
  const withCredit = await prisma.$queryRaw<{ companyId: string }[]>`
    SELECT DISTINCT p."companyId" FROM "Payment" p
    LEFT JOIN (SELECT "paymentId", sum(amount) AS a FROM "PaymentAllocation" GROUP BY 1) x ON x."paymentId" = p.id
    WHERE p.direction = 'INBOUND' AND p.status = 'CONFIRMED' AND p.amount - p."refundedAmount" - coalesce(x.a, 0) > 0.004
    LIMIT 500`;
  for (const { companyId } of withCredit) {
    if (!(await customerCredit(companyId)).length) continue;
    out.creditApplied += await prisma.$transaction((tx) => applyCustomerCredit(tx, companyId));
  }
  return out;
}
