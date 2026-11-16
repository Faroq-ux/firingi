/**
 * Early payout (Phase 36). A supplier can ask FIRINGI to pay approved invoices before their due date —
 * whether or not the customer has paid FIRINGI yet (FIRINGI carries the wait). The fee follows the
 * supplier's plan: a % per day early or a flat %, with a minimum fee and some free early payouts a month.
 * FIRINGI's finance team pays it (bank transfer recorded) or turns it down. On payment:
 *   - a FIRINGI service invoice for the fee (with VAT) is issued,
 *   - an outbound payment of the net amount goes to the supplier's invoices,
 *   - the fee is settled against the rest of those invoices ("Compensação": an inbound payment to the fee
 *     invoice and an outbound one of the same amount to the supplier's invoices),
 * so the supplier's invoices end up fully paid. Each supplier has a limit on how much may be paid early at
 * once (still before its normal date); FIRINGI can switch early payout off per supplier. Payments above the
 * four-eyes threshold need a second person.
 */
import "server-only";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { earlyFee, type EarlyPayModel } from "@/lib/plans";
import { markVendorInvoicesPaid, openVendorInvoices, plansSettings, subscriptionOf } from "./service";

type Tx = Prisma.TransactionClient;
const DAY = 86400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function supplierCan(ctx: Ctx) {
  if (!["WHOLESALER", "DISTRIBUTOR"].includes(ctx.company.type)) throw new ForbiddenError();
  if (!ctx.membership.isOwner && !can(ctx, ["vendor.invoices.view", "vendor.payments.view"])) throw new ForbiddenError();
}
function financeCan(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.finance.manage" : ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError();
}

/** VAT FIRINGI adds to a service invoice for this supplier (its country's standard rate; 0 under reverse charge). */
export async function serviceVatRate(companyId: string) {
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { countryId: true } });
  if (!co) return 0;
  const le = await prisma.legalEntity.findFirst({ where: { countryId: co.countryId, isActive: true } });
  if (!le) return 0;
  const r = await prisma.taxRate.findFirst({ where: { countryId: le.countryId, regionId: null, taxCategory: { code: "STANDARD" }, validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] }, orderBy: { validFrom: "desc" } });
  return Number(r?.rate ?? 0);
}

/** What the supplier could be paid early now, with the fee and the limit left. */
export async function earlyPayOptions(companyId: string, now = new Date(), tx: Tx | typeof prisma = prisma) {
  const s = await plansSettings();
  const sub = await subscriptionOf(companyId, now);
  const why = !s.enabled ? "PLANS_OFF" : !s.earlyPay.enabled ? "OFF" : !sub ? "NOT_SUPPLIER" : !sub.earlyPayEnabled ? "SUPPLIER_OFF" : sub.plan.earlyPayModel === "OFF" ? "PLAN" : null;
  const { paymentPolicy } = await import("@/server/services/payments");
  const payoutDays = (await paymentPolicy()).supplierPayoutDays;
  const busy = await tx.earlyPayoutLine.findMany({ where: { payout: { companyId, status: { in: ["REQUESTED", "PAID"] } } }, select: { vendorInvoiceId: true, amount: true, dueDate: true, payout: { select: { status: true } } } });
  const today = startOfDay(now);
  const outstanding = r2(busy.filter((b) => b.payout.status === "REQUESTED" || b.dueDate.getTime() > today).reduce((a, b) => a + Number(b.amount), 0));
  const limit = sub ? Number(sub.earlyPayLimit ?? s.earlyPay.defaultLimit) : 0;
  const open = await openVendorInvoices(tx, companyId, { excludeIds: busy.map((b) => b.vendorInvoiceId) });
  const model = (sub?.plan.earlyPayModel ?? "OFF") as EarlyPayModel;
  const rate = Number(sub?.plan.earlyPayRate ?? 0);
  const invoices = open.map((v) => {
    const due = v.dueDate ?? new Date(v.issueDate.getTime() + payoutDays * DAY);
    const days = Math.round((startOfDay(due) - today) / DAY);
    const amount = r2(v.open.toNumber());
    return { id: v.id, number: v.number, issueDate: v.issueDate, dueDate: due, days, amount, fee: earlyFee(model, rate, amount, days), eligible: days >= s.earlyPay.minDaysEarly };
  }).sort((a, b) => b.days - a.days);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usedFree = sub ? await tx.earlyPayout.count({ where: { companyId, status: "PAID", model: "FREE", decidedAt: { gte: monthStart } } }) : 0;
  return {
    available: why === null, why, model, rate, minFee: Number(sub?.plan.earlyPayMinFee ?? 0), freeLeft: Math.max(0, (sub?.plan.freeEarlyPays ?? 0) - usedFree),
    limit, outstanding, room: r2(Math.max(0, limit - outstanding)), minDaysEarly: s.earlyPay.minDaysEarly, invoices, plan: sub?.plan.name ?? null,
  };
}

type Quote = { lines: { id: string; number: string; dueDate: Date; days: number; amount: number; fee: number }[]; amount: number; fee: number; model: string; rate: number };

function quoteFrom(o: Awaited<ReturnType<typeof earlyPayOptions>>, ids: string[]): Quote {
  const pick = o.invoices.filter((i) => ids.includes(i.id));
  if (pick.length !== new Set(ids).size) throw new ValidationError("Some invoices can't be paid early any more. Reload and try again.");
  if (pick.some((p) => !p.eligible)) throw new ValidationError(`Only invoices due in ${o.minDaysEarly} days or more can be paid early.`);
  const amount = r2(pick.reduce((a, p) => a + p.amount, 0));
  const free = o.freeLeft > 0;
  let fee = free ? 0 : r2(pick.reduce((a, p) => a + p.fee, 0));
  if (!free && fee < o.minFee) fee = Math.min(o.minFee, amount);
  return { lines: pick.map((p) => ({ id: p.id, number: p.number, dueDate: p.dueDate, days: p.days, amount: p.amount, fee: free ? 0 : p.fee })), amount, fee, model: free ? "FREE" : o.model, rate: o.rate };
}

export async function myEarlyPay(ctx: Ctx, now = new Date()) {
  supplierCan(ctx);
  const [o, history] = await Promise.all([
    earlyPayOptions(ctx.company.id, now),
    prisma.earlyPayout.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 50, include: { lines: true } }),
  ]);
  const docs = history.some((h) => h.feeInvoiceId) ? await prisma.invoice.findMany({ where: { id: { in: history.flatMap((h) => (h.feeInvoiceId ? [h.feeInvoiceId] : [])) } }, select: { id: true, fullNumber: true } }) : [];
  return { ...o, vatRate: await serviceVatRate(ctx.company.id), history: history.map((h) => ({ ...h, feeInvoice: docs.find((d) => d.id === h.feeInvoiceId) ?? null })) };
}

/** Preview (no changes): what the supplier would receive. */
export async function quoteEarlyPay(ctx: Ctx, vendorInvoiceIds: string[], now = new Date()) {
  supplierCan(ctx);
  const o = await earlyPayOptions(ctx.company.id, now);
  if (!o.available) throw new AppError("EARLY_PAY_UNAVAILABLE", "Early payout isn't available for your company.", 409);
  const q = quoteFrom(o, vendorInvoiceIds);
  return { ...q, room: o.room };
}

export async function requestEarlyPay(ctx: Ctx, vendorInvoiceIds: string[], now = new Date()) {
  supplierCan(ctx);
  if (!vendorInvoiceIds.length) throw new ValidationError("Choose at least one invoice.");
  const { nextNumber } = await import("@/server/services/orders");
  const payout = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${ctx.company.id} FOR UPDATE`;
    const o = await earlyPayOptions(ctx.company.id, now, tx);
    if (!o.available) throw new AppError("EARLY_PAY_UNAVAILABLE", "Early payout isn't available for your company.", 409);
    const q = quoteFrom(o, vendorInvoiceIds);
    if (q.amount > o.room + 0.001) throw new AppError("EARLY_PAY_LIMIT", `Over your early payout limit: you can ask for up to ${o.room.toFixed(2)} € now.`, 409, { room: o.room.toFixed(2) });
    const number = await nextNumber(tx, "earlypay", "EP");
    return tx.earlyPayout.create({
      data: {
        number, companyId: ctx.company.id, amount: q.amount.toFixed(2), fee: q.fee.toFixed(2), feeGross: q.fee.toFixed(2), net: (q.amount - q.fee).toFixed(2), model: q.model, rate: q.rate, requestedById: ctx.user.id,
        lines: { create: q.lines.map((l) => ({ vendorInvoiceId: l.id, amount: l.amount.toFixed(2), dueDate: l.dueDate, days: l.days, fee: l.fee.toFixed(2) })) },
      },
    });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "earlypay.requested", entityType: "EarlyPayout", entityId: payout.id, after: { number: payout.number, amount: payout.amount.toString(), fee: payout.fee.toString() } });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  if (admin) await notify("earlypay.requested", [{ companyId: admin.id, link: "/admin/vendors/plans/early-payouts" }], { company: ctx.company.tradeName ?? ctx.company.legalName, number: payout.number, amount: payout.amount.toString() }).catch(() => null);
  return payout;
}

export async function cancelEarlyPay(ctx: Ctx, id: string) {
  supplierCan(ctx);
  const p = await prisma.earlyPayout.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!p) throw new NotFoundError("Early payout");
  if (p.status !== "REQUESTED") throw new ValidationError("Only a request still waiting can be cancelled.");
  await prisma.earlyPayout.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "earlypay.cancelled", entityType: "EarlyPayout", entityId: id });
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function listEarlyPayouts(ctx: Ctx, status?: "REQUESTED" | "PAID" | "REJECTED" | "CANCELLED") {
  financeCan(ctx);
  const rows = await prisma.earlyPayout.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 300, include: { lines: true, company: { select: { id: true, legalName: true, tradeName: true } } } });
  const vis = await prisma.vendorInvoice.findMany({ where: { id: { in: rows.flatMap((r) => r.lines.map((l) => l.vendorInvoiceId)) } }, select: { id: true, externalNumber: true } });
  return rows.map((r) => ({ ...r, company: r.company.tradeName ?? r.company.legalName, companyId: r.company.id, lines: r.lines.map((l) => ({ ...l, number: vis.find((v) => v.id === l.vendorInvoiceId)?.externalNumber ?? "—" })) }));
}

/** FIRINGI sent the money: fee invoice, payments, compensation. */
export async function payEarlyPayout(ctx: Ctx, id: string, input: { reference?: string | null } = {}) {
  financeCan(ctx, true);
  const p = await prisma.earlyPayout.findUnique({ where: { id }, include: { lines: true, company: { select: { legalName: true, tradeName: true } } } });
  if (!p) throw new NotFoundError("Early payout");
  if (p.status !== "REQUESTED") throw new ValidationError("This early payout was already decided.");
  const { approvalSettings, fourEyes } = await import("@/server/approvals/gate");
  const a = await approvalSettings();
  if (a.enabled && Number(p.net) > a.paymentAbove)
    await fourEyes(ctx, { kind: "EARLY_PAYOUT", summary: `Early payout ${p.number} to ${p.company.tradeName ?? p.company.legalName}: ${Number(p.net).toFixed(2)} €`, payload: { earlyPayoutId: id, reference: input.reference ?? null }, amount: Number(p.net), companyId: p.companyId });

  const { issueServiceInvoice } = await import("@/server/invoicing/service");
  const res = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "EarlyPayout" WHERE id = ${id} FOR UPDATE`;
    const fresh = await tx.earlyPayout.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== "REQUESTED") throw new ValidationError("This early payout was already decided.");
    // the invoices must still be open for the requested amounts
    const open = await openVendorInvoices(tx, p.companyId);
    for (const l of p.lines) {
      const v = open.find((x) => x.id === l.vendorInvoiceId);
      if (!v || v.open.lt(new Decimal(l.amount.toString()).minus(0.004))) throw new AppError("EARLY_PAY_STALE", "An invoice in this request was paid or changed meanwhile — turn the request down and let the supplier ask again.", 409);
    }
    const amount = new Decimal(p.amount.toString());
    let feeGross = new Decimal(0), feeInvoiceId: string | null = null, feeNumber: string | null = null;
    if (new Decimal(p.fee.toString()).gt(0)) {
      const inv = await issueServiceInvoice(tx, { recipientCompanyId: p.companyId, docType: "INVOICE", dueDays: 0, actorUserId: ctx.user.id, lines: [{ description: `Antecipação de pagamento ${p.number} — ${p.lines.length} fatura(s)`, net: new Decimal(p.fee.toString()) }] });
      feeGross = new Decimal(inv.grossTotal.toString()); feeInvoiceId = inv.id; feeNumber = inv.fullNumber;
    }
    const net = amount.minus(feeGross);
    if (net.lte(0)) throw new ValidationError("The fee is as large as the amount — nothing to pay.");
    // split each invoice's amount between the bank transfer (first) and the compensation of the fee (rest)
    let bankLeft = net;
    const bank: { vendorInvoiceId: string; amount: Decimal }[] = [], comp: { vendorInvoiceId: string; amount: Decimal }[] = [];
    for (const l of p.lines) {
      const amt = new Decimal(l.amount.toString());
      const b = Decimal.min(amt, bankLeft);
      if (b.gt(0)) bank.push({ vendorInvoiceId: l.vendorInvoiceId, amount: b });
      if (amt.minus(b).gt(0)) comp.push({ vendorInvoiceId: l.vendorInvoiceId, amount: amt.minus(b) });
      bankLeft = bankLeft.minus(b);
    }
    const reference = input.reference?.trim() || `FIRINGI ${p.number}`;
    await tx.payment.create({ data: { companyId: p.companyId, direction: "OUTBOUND", method: "BANK_TRANSFER", amount: net.toFixed(2), reference, status: "CONFIRMED", paidAt: new Date(), recordedById: ctx.user.id, allocations: { create: bank.map((x) => ({ vendorInvoiceId: x.vendorInvoiceId, amount: x.amount.toFixed(2) })) } } });
    if (feeInvoiceId && feeGross.gt(0)) {
      const ref = `Compensação ${feeNumber ?? p.number}`;
      await tx.payment.create({ data: { companyId: p.companyId, direction: "INBOUND", method: "OTHER", amount: feeGross.toFixed(2), reference: ref, status: "CONFIRMED", paidAt: new Date(), recordedById: ctx.user.id, allocations: { create: [{ invoiceId: feeInvoiceId, amount: feeGross.toFixed(2) }] } } });
      await tx.payment.create({ data: { companyId: p.companyId, direction: "OUTBOUND", method: "OTHER", amount: feeGross.toFixed(2), reference: ref, status: "CONFIRMED", paidAt: new Date(), recordedById: ctx.user.id, allocations: { create: comp.map((x) => ({ vendorInvoiceId: x.vendorInvoiceId, amount: x.amount.toFixed(2) })) } } });
    }
    await markVendorInvoicesPaid(tx, p.lines.map((l) => l.vendorInvoiceId));
    await (await import("@/server/integrations/webhooks")).emitWebhook(tx, p.companyId, "payout.sent", { paymentId: null, amount: net.toFixed(2), method: "BANK_TRANSFER", reference, paidAt: new Date().toISOString(), documents: p.lines.map((l) => l.vendorInvoiceId), earlyPayout: p.number });
    return tx.earlyPayout.update({ where: { id }, data: { status: "PAID", feeGross: feeGross.toFixed(2), net: net.toFixed(2), feeInvoiceId, reference, decidedById: ctx.user.id, decidedAt: new Date() } });
  });
  const { kickFiscalQueue } = await import("@/server/invoicing/fiscal");
  kickFiscalQueue();
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "earlypay.paid", entityType: "EarlyPayout", entityId: id, after: { number: res.number, net: res.net.toString(), fee: res.fee.toString(), feeGross: res.feeGross.toString() } });
  await notify("earlypay.paid", [{ companyId: p.companyId, link: "/vendor/finance/early-payout" }], { number: res.number, net: res.net.toString() }).catch(() => null);
  return res;
}

export async function rejectEarlyPayout(ctx: Ctx, id: string, reason: string) {
  financeCan(ctx, true);
  if (reason.trim().length < 3) throw new ValidationError("Tell the supplier why.");
  const p = await prisma.earlyPayout.findUnique({ where: { id } });
  if (!p) throw new NotFoundError("Early payout");
  if (p.status !== "REQUESTED") throw new ValidationError("This early payout was already decided.");
  await prisma.earlyPayout.update({ where: { id }, data: { status: "REJECTED", reason: reason.trim(), decidedById: ctx.user.id, decidedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "earlypay.rejected", entityType: "EarlyPayout", entityId: id, after: { reason } });
  await notify("earlypay.rejected", [{ companyId: p.companyId, link: "/vendor/finance/early-payout" }], { number: p.number, reason: reason.trim() }).catch(() => null);
}
