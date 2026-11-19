/**
 * Online payments: payment requests (pay these invoices / this order), starting a payment with
 * the provider, applying the provider's confirmations exactly once, matching the money to the
 * invoices, customer credit (money not matched yet) and refunds.
 *
 * Money rules
 *  • An invoice's open amount = gross − credit notes − confirmed payments allocated to it.
 *  • When a provider confirms a payment, FIRINGI records a CONFIRMED Payment and allocates it to
 *    the request's invoices (never more than what is still open). Whatever is left is customer
 *    credit, used automatically on the customer's next invoices (oldest due first).
 *  • A pay-before-shipping prepayment stays with its order until the order is invoiced.
 *  • A confirmation is applied once: provider events are stored by id (PaymentEvent), and a paid
 *    request can't change afterwards (database rule).
 */
import "server-only";
import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import type { PaymentMethod, PaymentRequestSource, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { paymentPolicy } from "@/server/services/payments";
import { activeProvider, providerByKey } from "./provider";
import type { OnlineMethod, Party, PayAction, ProviderEvent } from "./types";
import { ProviderError, WebhookError } from "./types";

const ZERO = new Decimal(0);
const D = (v: Decimal.Value | { toString(): string } | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INVOICE_TYPES = ["INVOICE", "INVOICE_RECEIPT"] as const;

// ── amounts ─────────────────────────────────────────────────────────────────

/** Open amount per invoice (gross − credit notes − confirmed payments). */
export async function openAmounts(invoiceIds: string[], db: Tx | typeof prisma = prisma) {
  if (!invoiceIds.length) return new Map<string, Decimal>();
  const rows = await db.invoice.findMany({
    where: { id: { in: invoiceIds }, docType: { in: [...INVOICE_TYPES] }, status: { not: "DRAFT" } },
    select: { id: true, grossTotal: true, creditNotes: { where: { status: { not: "DRAFT" } }, select: { grossTotal: true } }, allocations: { where: { payment: { status: { in: ["CONFIRMED", "REFUNDED"] } } }, select: { amount: true } } },
  });
  return new Map(rows.map((i) => [i.id, Decimal.max(ZERO, D(i.grossTotal).minus(i.creditNotes.reduce((a, c) => a.plus(D(c.grossTotal)), ZERO)).minus(i.allocations.reduce((a, x) => a.plus(D(x.amount)), ZERO)))]));
}

/** A confirmed payment's money not yet allocated to invoices nor refunded. */
const unallocated = (p: { amount: unknown; refundedAmount: unknown; allocations: { amount: unknown }[] }) =>
  D(p.amount as string).minus(D(p.refundedAmount as string)).minus(p.allocations.reduce((a: Decimal, x) => a.plus(D(x.amount as string)), ZERO));

/** Customer credit: confirmed payments with money left (prepayments of orders not invoiced yet aside). */
export async function customerCredit(companyId: string, db: Tx | typeof prisma = prisma) {
  const pays = await db.payment.findMany({
    where: { companyId, direction: "INBOUND", status: "CONFIRMED" },
    select: { id: true, amount: true, refundedAmount: true, paidAt: true, method: true, allocations: { select: { amount: true } }, request: { select: { orderId: true, order: { select: { status: true, number: true } } } } },
    orderBy: { paidAt: "asc" },
  });
  return pays
    .map((p) => ({ id: p.id, paidAt: p.paidAt, method: p.method, free: unallocated(p), orderId: p.request?.orderId ?? null, orderNumber: p.request?.order?.number ?? null, orderStatus: p.request?.order?.status ?? null }))
    .filter((p) => p.free.gt(0.004));
}

/**
 * Use the customer's credit on open invoices (inside the caller's transaction): a prepayment goes
 * to its own order's invoice first; other credit to the oldest open invoices.
 */
export async function applyCustomerCredit(tx: Tx, companyId: string) {
  const credit = await customerCredit(companyId, tx);
  if (!credit.length) return 0;
  const invoices = await tx.invoice.findMany({
    where: { recipientCompanyId: companyId, docType: { in: [...INVOICE_TYPES] }, status: { not: "DRAFT" } },
    select: { id: true, orderId: true, dueAt: true, issuedAt: true }, orderBy: [{ dueAt: "asc" }, { issuedAt: "asc" }],
  });
  const open = await openAmounts(invoices.map((i) => i.id), tx);
  let applied = 0;
  for (const c of credit) {
    // A prepayment waits for its order's invoice, unless the order ended without one.
    const waiting = c.orderId && !invoices.some((i) => i.orderId === c.orderId) && c.orderStatus !== "CANCELLED" && c.orderStatus !== "RETURNED";
    if (waiting) continue;
    let free = c.free;
    const targets = [...invoices.filter((i) => c.orderId && i.orderId === c.orderId), ...invoices.filter((i) => !c.orderId || i.orderId !== c.orderId)];
    for (const inv of targets) {
      if (free.lte(0.004)) break;
      const o = open.get(inv.id) ?? ZERO;
      if (o.lte(0.004)) continue;
      const amt = Decimal.min(o, free);
      await tx.paymentAllocation.create({ data: { paymentId: c.id, invoiceId: inv.id, amount: amt.toFixed(2) } });
      open.set(inv.id, o.minus(amt));
      free = free.minus(amt);
      applied++;
    }
  }
  return applied;
}

// ── requests ────────────────────────────────────────────────────────────────

const newToken = () => randomBytes(24).toString("base64url");

type CreateInput = { companyId: string; invoiceIds?: string[]; orderId?: string; source: PaymentRequestSource; createdById?: string | null; expiresInHours?: number };

/** Create a payment request (internal — callers check who may do it). */
export async function createRequest(input: CreateInput) {
  const policy = await paymentPolicy();
  const hours = input.expiresInHours ?? (input.source === "BUYER" || input.source === "ORDER" ? 24 : policy.online.linkExpiryDays * 24);
  return prisma.$transaction(async (tx) => {
    let items: { invoiceId: string; amount: Decimal }[] = [];
    let amount = ZERO;
    if (input.orderId) {
      const o = await tx.order.findUnique({ where: { id: input.orderId }, select: { buyerCompanyId: true, awaitingPayment: true, grandTotal: true, prepayBuffer: true, status: true } });
      if (!o || o.buyerCompanyId !== input.companyId) throw new NotFoundError("Order");
      if (!o.awaitingPayment || o.status !== "ON_HOLD") throw new ValidationError("This order doesn't need a payment.");
      const paid = await tx.paymentRequest.aggregate({ where: { orderId: input.orderId, status: "PAID" }, _sum: { paidAmount: true } });
      amount = D(o.grandTotal).plus(D(o.prepayBuffer)).minus(D(paid._sum.paidAmount)); // Phase 41: + buffer on sold-by-weight lines
      const busy = await tx.paymentRequest.findFirst({ where: { orderId: input.orderId, status: "PROCESSING" } });
      if (busy) throw new AppError("PAYMENT_IN_PROGRESS", "A payment for this order is already in progress.", 409);
      await tx.paymentRequest.updateMany({ where: { orderId: input.orderId, status: "OPEN" }, data: { status: "CANCELLED" } });
    } else {
      const ids = [...new Set(input.invoiceIds ?? [])];
      if (!ids.length) throw new ValidationError("Choose at least one invoice.");
      const invs = await tx.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, recipientCompanyId: true, docType: true, status: true, fullNumber: true, providerNumber: true } });
      if (invs.length !== ids.length || invs.some((i) => i.recipientCompanyId !== input.companyId || !INVOICE_TYPES.includes(i.docType as (typeof INVOICE_TYPES)[number]) || i.status === "DRAFT")) throw new NotFoundError("Invoice");
      const busy = await tx.paymentRequestItem.findFirst({ where: { invoiceId: { in: ids }, request: { status: "PROCESSING" } }, include: { invoice: { select: { fullNumber: true, providerNumber: true } } } });
      if (busy) throw new AppError("PAYMENT_IN_PROGRESS", `A payment for ${busy.invoice.providerNumber ?? busy.invoice.fullNumber} is already in progress.`, 409);
      const open = await openAmounts(ids, tx);
      items = ids.map((id) => ({ invoiceId: id, amount: open.get(id) ?? ZERO })).filter((x) => x.amount.gt(0.004));
      if (!items.length) throw new ValidationError("These invoices are already paid.");
      amount = items.reduce((a, x) => a.plus(x.amount), ZERO);
      // Older unstarted requests for the same invoices give way to this one.
      await tx.paymentRequest.updateMany({ where: { status: "OPEN", items: { some: { invoiceId: { in: ids } } } }, data: { status: "CANCELLED" } });
    }
    if (amount.lte(0.004)) throw new ValidationError("Nothing left to pay.");
    // Phase 45: charged in the documents' currency (one currency per payment)
    const { requestCurrency } = await import("@/server/currency/payments");
    const cur = await requestCurrency(tx, { orderId: input.orderId, amountEur: amount, items }).catch((e) => {
      if (e instanceof Error && e.message === "MIXED_CURRENCIES") throw new ValidationError("These invoices are in different currencies — pay them separately.");
      throw e;
    });
    return tx.paymentRequest.create({
      data: {
        currencyCode: cur.currencyCode, amountLocal: cur.amountLocal,
        token: newToken(), companyId: input.companyId, orderId: input.orderId ?? null, amount: amount.toFixed(2), source: input.source,
        expiresAt: new Date(Date.now() + hours * 3600_000), createdById: input.createdById ?? null,
        items: { create: items.map((i) => ({ invoiceId: i.invoiceId, amount: i.amount.toFixed(2) })) },
      },
    });
  });
}

/** The customer pays invoices from the portal. */
export async function buyerPayInvoices(ctx: Ctx, invoiceIds: string[]) {
  if (!can(ctx, "buyer.payments.make")) throw new ForbiddenError();
  return createRequest({ companyId: ctx.company.id, invoiceIds, source: "BUYER", createdById: ctx.user.id });
}

/** The customer pays an order that waits for payment. */
export async function buyerPayOrder(ctx: Ctx, orderId: string) {
  if (!can(ctx, ["buyer.payments.make", "buyer.orders.place"])) throw new ForbiddenError();
  return createRequest({ companyId: ctx.company.id, orderId, source: "ORDER", createdById: ctx.user.id });
}

/** FIRINGI staff: a payment link for some (or all open) invoices of a customer. */
export async function staffPaymentLink(ctx: Ctx, companyId: string, invoiceIds?: string[]) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.manage", "admin.invoices.view"])) throw new ForbiddenError();
  let ids = invoiceIds;
  if (!ids?.length) {
    const all = await prisma.invoice.findMany({ where: { recipientCompanyId: companyId, docType: { in: [...INVOICE_TYPES] }, status: { not: "DRAFT" } }, select: { id: true } });
    const open = await openAmounts(all.map((i) => i.id));
    ids = all.filter((i) => (open.get(i.id) ?? ZERO).gt(0.004)).map((i) => i.id);
    const busy = new Set((await prisma.paymentRequestItem.findMany({ where: { invoiceId: { in: ids }, request: { status: "PROCESSING" } }, select: { invoiceId: true } })).map((x) => x.invoiceId));
    ids = ids.filter((id) => !busy.has(id));
  }
  if (!ids.length) throw new ValidationError("This customer has no open invoices to pay.");
  const r = await createRequest({ companyId, invoiceIds: ids, source: "STAFF", createdById: ctx.user.id });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "payment.link_created", entityType: "PaymentRequest", entityId: r.id, after: { companyId, amount: r.amount.toString(), invoices: ids.length } });
  return { ...r, url: payLinkUrl(r.token) };
}

export const payLinkUrl = (token: string) => `${appUrl()}/pay/${token}`;

/** Load a request for its pay page: by id for the signed-in customer, or by public token. */
export async function requestForPayer(by: { ctx: Ctx; id: string } | { token: string }) {
  const r = await prisma.paymentRequest.findUnique({
    where: "token" in by ? { token: by.token } : { id: by.id },
    include: {
      company: { select: { id: true, legalName: true, tradeName: true, countryId: true } },
      order: { select: { id: true, number: true, status: true } },
      items: { include: { invoice: { select: { id: true, fullNumber: true, providerNumber: true, issuedAt: true, dueAt: true, grossTotal: true } } } },
    },
  });
  if (!r) throw new NotFoundError("Payment");
  if ("ctx" in by && (r.companyId !== by.ctx.company.id || !can(by.ctx, ["buyer.payments.make", "buyer.payments.view", "buyer.invoices.view"]))) throw new NotFoundError("Payment");
  return r;
}

/** Methods the customer can use right now (settings ∩ provider), plus whether a mandate is active. */
export async function availableMethods(companyId: string) {
  const [policy, mandate] = await Promise.all([paymentPolicy(), prisma.sepaMandate.findFirst({ where: { companyId, status: "ACTIVE" } })]);
  const provider = activeProvider();
  const methods = (provider?.methods ?? []).filter((m) => policy.methods[m]);
  return { methods, provider: provider ? { key: provider.key, label: provider.label, mode: provider.mode } : null, mandate: mandate ? { id: mandate.id, ibanLast4: mandate.ibanLast4 } : null };
}

async function partyFor(companyId: string): Promise<Party> {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, legalName: true, tradeName: true, email: true, taxId: true, country: { select: { defaultLanguageCode: true } } } });
  return { companyId: c.id, name: c.tradeName ?? c.legalName, email: c.email, taxId: c.taxId, locale: c.country.defaultLanguageCode ?? "pt" };
}

async function describe(requestId: string) {
  const r = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId }, include: { order: { select: { number: true } }, items: { include: { invoice: { select: { fullNumber: true, providerNumber: true } } } } } });
  const docs = r.order ? r.order.number : r.items.map((i) => i.invoice.providerNumber ?? i.invoice.fullNumber).join(", ");
  return `FIRINGI ${docs}`.slice(0, 200);
}

/**
 * Start paying a request with a method. Returns what the payer must do next.
 * `via` = where the payer is (the portal page or the public link), for the return address.
 */
export async function startPayment(requestId: string, method: OnlineMethod, opts: { phone?: string | null; via: "portal" | "link" }) {
  const r = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (r.status === "PAID") throw new ValidationError("This has been paid already.");
  if (r.status === "PROCESSING") throw new AppError("PAYMENT_IN_PROGRESS", "This payment is already in progress.", 409);
  if (r.status === "CANCELLED" || r.status === "EXPIRED" || r.expiresAt < new Date()) {
    if (r.status === "OPEN") await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: "EXPIRED" } });
    throw new AppError("PAYMENT_EXPIRED", "This payment request has expired.", 410);
  }
  const provider = activeProvider();
  const { methods, mandate } = await availableMethods(r.companyId);
  if (!provider || !methods.includes(method)) throw new ValidationError("This payment method isn't available.");
  // The payer may come back to an attempt that was refused and try again.
  if (r.status === "FAILED") await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: "OPEN", failureReason: null } });
  const payer = await partyFor(r.companyId);
  const description = await describe(r.id);
  const back = opts.via === "link" ? `${appUrl()}/pay/${r.token}` : `${appUrl()}/buy/finance/pay/${r.id}`;
  try {
    if (method === "DIRECT_DEBIT") {
      const m = mandate ? await prisma.sepaMandate.findUniqueOrThrow({ where: { id: mandate.id } }) : null;
      if (!m) throw new ValidationError("Set up a direct debit first.");
      return await collectWithMandate(r.id, m, description, payer);
    }
    const res = await provider.start({ requestId: r.id, amount: D(r.amountLocal ?? r.amount).toFixed(2), currency: r.currencyCode, method, payer, description, returnUrl: `${back}?return=1`, cancelUrl: back, phone: opts.phone });
    await prisma.paymentRequest.update({
      where: { id: r.id },
      data: { provider: provider.key, method: method as PaymentMethod, providerRef: res.providerRef, action: res.action as Prisma.InputJsonValue, status: res.status, ...(res.expiresAt && res.expiresAt < r.expiresAt ? { expiresAt: res.expiresAt } : {}) },
    });
    return { status: res.status, action: res.action };
  } catch (e) {
    if (e instanceof ProviderError) throw new AppError(e.retryable ? "PROVIDER_UNAVAILABLE" : "PAYMENT_REFUSED", e.message, e.retryable ? 503 : 422);
    throw e;
  }
}

async function collectWithMandate(requestId: string, m: { id: string; provider: string; providerCustomerRef: string | null; providerPaymentMethodRef: string | null; providerMandateRef: string | null }, description: string, payer: Party) {
  const provider = providerByKey(m.provider);
  if (!provider) throw new ValidationError("The direct debit provider isn't configured.");
  const r = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId } });
  const res = await provider.collect({ requestId, amount: D(r.amountLocal ?? r.amount).toFixed(2), currency: r.currencyCode, description, payer, mandate: { customerRef: m.providerCustomerRef, paymentMethodRef: m.providerPaymentMethodRef, mandateRef: m.providerMandateRef } });
  await prisma.paymentRequest.update({ where: { id: requestId }, data: { provider: provider.key, method: "DIRECT_DEBIT", providerRef: res.providerRef, mandateId: m.id, action: { type: "none" }, status: res.status === "PAID" ? "PROCESSING" : res.status, failureReason: res.failureReason ?? null } });
  if (res.status === "PAID") await applyEvent(provider.key, { eventId: `collect_${res.providerRef}`, type: "collect", kind: "payment.succeeded", requestId, providerRef: res.providerRef, providerPaymentRef: res.providerRef, payload: { collect: true } });
  if (res.status === "FAILED") await applyEvent(provider.key, { eventId: `collect_${res.providerRef}`, type: "collect", kind: "payment.failed", requestId, providerRef: res.providerRef, failureReason: res.failureReason, payload: { collect: true } });
  return { status: res.status === "PAID" ? "PAID" : res.status, action: { type: "none" } as PayAction };
}

/** Direct debit: collect these due invoices from the customer's active mandate (the payments job). */
export async function collectDue(companyId: string, invoiceIds: string[]) {
  const m = await prisma.sepaMandate.findFirst({ where: { companyId, status: "ACTIVE" } });
  if (!m) return null;
  const r = await createRequest({ companyId, invoiceIds, source: "DIRECT_DEBIT", expiresInHours: 14 * 24 });
  return collectWithMandate(r.id, m, await describe(r.id), await partyFor(companyId));
}

// ── provider events ─────────────────────────────────────────────────────────

/** Webhook entry point: verify, store each event once, apply it. */
export async function receiveWebhook(providerKey: string, rawBody: string, headers: Headers) {
  const provider = providerByKey(providerKey);
  if (!provider) throw new WebhookError("Unknown provider");
  const events = await provider.parseWebhook(rawBody, headers);
  let applied = 0;
  for (const ev of events) if (await applyEvent(provider.key, ev)) applied++;
  return { received: events.length, applied };
}

/** Apply one provider event exactly once. Returns false when it had been applied already. */
export async function applyEvent(providerKey: string, ev: ProviderEvent): Promise<boolean> {
  const existing = await prisma.paymentEvent.findUnique({ where: { provider_eventId: { provider: providerKey, eventId: ev.eventId } } });
  if (existing?.processedAt) return false;
  const row = existing ?? (await prisma.paymentEvent.create({ data: { provider: providerKey, eventId: ev.eventId, type: ev.type, payload: (ev.payload ?? {}) as Prisma.InputJsonValue } }).catch(() => null));
  if (!row) return false; // a parallel delivery of the same event is handling it
  try {
    await handle(providerKey, ev);
    await prisma.paymentEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), error: null } });
    return true;
  } catch (e) {
    await prisma.paymentEvent.update({ where: { id: row.id }, data: { error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) } });
    throw e;
  }
}

async function findRequest(providerKey: string, ev: ProviderEvent) {
  if (ev.requestId) { const r = await prisma.paymentRequest.findUnique({ where: { id: ev.requestId } }); if (r) return r; }
  if (ev.providerRef) return prisma.paymentRequest.findUnique({ where: { provider_providerRef: { provider: providerKey, providerRef: ev.providerRef } } });
  return null;
}

async function handle(providerKey: string, ev: ProviderEvent) {
  if (ev.kind === "ignored") return;
  if (ev.kind.startsWith("mandate.")) return handleMandate(providerKey, ev);
  const r = await findRequest(providerKey, ev);
  if (!r) return; // not ours (or a test event)
  if (ev.kind === "payment.succeeded") return settle(r.id, providerKey, ev);
  if (r.status === "PAID") return;
  if (ev.kind === "payment.processing") {
    if (r.status === "OPEN") await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: "PROCESSING" } });
    return;
  }
  if (ev.kind === "payment.expired") {
    if (r.status === "OPEN" || r.status === "PROCESSING") await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: "EXPIRED" } });
    return;
  }
  if (ev.kind === "payment.failed") {
    await prisma.paymentRequest.update({ where: { id: r.id }, data: { status: "FAILED", failureReason: (ev.failureReason ?? "Payment failed").slice(0, 300) } });
    const { notifyPaymentFailed } = await import("./notices");
    await notifyPaymentFailed(r.id);
  }
}

/** Money confirmed by the provider → Payment + allocations (+ release a prepaid order). */
async function settle(requestId: string, providerKey: string, ev: ProviderEvent) {
  const result = await prisma.$transaction(async (tx) => {
    // Lock the request so two confirmations can't both record a payment.
    await tx.$queryRaw`SELECT id FROM "PaymentRequest" WHERE id = ${requestId} FOR UPDATE`;
    const r = await tx.paymentRequest.findUniqueOrThrow({ where: { id: requestId }, include: { items: true } });
    if (r.status === "PAID") return null;
    const foreign = r.currencyCode !== "EUR";
    // Phase 45: money in another currency — allocated in it, booked in EUR at the documents' rates (+ FX difference)
    const payment = foreign
      ? await (await import("@/server/currency/payments")).receiveForeign(tx, {
          companyId: r.companyId, code: r.currencyCode, amountLocal: ev.amount ? D(ev.amount) : D(r.amountLocal ?? r.amount), method: (r.method ?? "OTHER") as PaymentMethod,
          reference: ev.providerPaymentRef ?? r.providerRef ?? ev.providerRef ?? null, provider: providerKey,
          targets: r.items.map((i) => ({ invoiceId: i.invoiceId, maxEur: D(i.amount) })), orderId: r.orderId, openEur: await openAmounts(r.items.map((i) => i.invoiceId), tx),
        })
      : await tx.payment.create({
          data: {
            companyId: r.companyId, direction: "INBOUND", method: (r.method ?? "OTHER") as PaymentMethod, amount: (ev.amount ? D(ev.amount) : D(r.amount)).toFixed(2), currencyCode: r.currencyCode,
            reference: ev.providerPaymentRef ?? r.providerRef ?? ev.providerRef ?? null, status: "CONFIRMED", paidAt: new Date(), provider: providerKey,
          },
        });
    const paid = D(payment.amount);
    await (await import("@/server/integrations/webhooks")).emitWebhook(tx, r.companyId, "payment.received", { paymentId: payment.id, amount: payment.amount.toString(), method: payment.method, reference: payment.reference, paidAt: payment.paidAt?.toISOString() ?? null, documents: r.items.map((i) => i.invoiceId) });
    // Allocate to the request's invoices — never more than what is still open now.
    const open = await openAmounts(r.items.map((i) => i.invoiceId), tx);
    let free = foreign ? ZERO : paid;
    for (const it of r.items) {
      if (free.lte(0.004)) break;
      const amt = Decimal.min(free, open.get(it.invoiceId) ?? ZERO, D(it.amount));
      if (amt.lte(0.004)) continue;
      await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: it.invoiceId, amount: amt.toFixed(2) } });
      free = free.minus(amt);
    }
    await tx.paymentRequest.update({
      where: { id: r.id },
      data: { status: "PAID", paidAt: new Date(), paidAmount: paid.toFixed(2), paymentId: payment.id, providerPaymentRef: ev.providerPaymentRef ?? r.providerPaymentRef, failureReason: null, ...(r.provider ? {} : { provider: providerKey }) },
    });
    // Anything left (overpaid, invoices paid meanwhile) is credit for the next invoices.
    if (!r.orderId) await applyCustomerCredit(tx, r.companyId);
    let released = false;
    if (r.orderId) {
      const o = await tx.order.findUniqueOrThrow({ where: { id: r.orderId }, select: { id: true, status: true, awaitingPayment: true, grandTotal: true, prepayBuffer: true } });
      const paidForOrder = await tx.paymentRequest.aggregate({ where: { orderId: o.id, status: "PAID" }, _sum: { paidAmount: true } });
      if (o.awaitingPayment && D(paidForOrder._sum.paidAmount).gte(D(o.grandTotal).plus(D(o.prepayBuffer)).minus(0.004))) {
        released = await releasePaidOrder(tx, o.id);
      }
    }
    const leftover = await customerCredit(r.companyId, tx).then((c) => c.find((x) => x.id === payment.id)?.free ?? ZERO);
    await writeAudit({ actorUserId: null, actorCompanyId: r.companyId, action: "payment.online_received", entityType: "Payment", entityId: payment.id, after: { requestId: r.id, provider: providerKey, method: r.method, amount: paid.toFixed(2), leftover: leftover.toFixed(2) } }, tx);
    return { paymentId: payment.id, leftover, orderId: r.orderId, released };
  });
  if (!result) return;
  const { notifyPaymentReceived } = await import("./notices");
  await notifyPaymentReceived(requestId, result);
}

/** Pay-before-shipping: the order is paid → the supplier gets it (unless FIRINGI's risk check still holds it). */
export async function releasePaidOrder(tx: Tx, orderId: string) {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, risk: { select: { held: true, review: true } } } });
  if (!o) return false;
  const stillRiskHeld = !!o.risk?.held && o.risk.review === "OPEN";
  await tx.order.update({ where: { id: orderId }, data: { awaitingPayment: false, ...(o.status === "ON_HOLD" && !stillRiskHeld ? { status: "PENDING_CONFIRMATION" } : {}) } });
  if (o.status === "ON_HOLD" && !stillRiskHeld) {
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: "ON_HOLD", toStatus: "PENDING_CONFIRMATION", reason: "Paid — sent to supplier" } });
    await (await import("@/server/integrations/webhooks")).emitOrderEvents(tx, orderId, { from: "ON_HOLD", to: "PENDING_CONFIRMATION", reason: "paid" });
    return true;
  }
  return false;
}

async function handleMandate(providerKey: string, ev: ProviderEvent) {
  const m = ev.mandateId ? await prisma.sepaMandate.findUnique({ where: { id: ev.mandateId } })
    : ev.setupRef ? await prisma.sepaMandate.findFirst({ where: { provider: providerKey, setupRef: ev.setupRef } })
    : ev.mandate?.mandateRef ? await prisma.sepaMandate.findFirst({ where: { provider: providerKey, providerMandateRef: ev.mandate.mandateRef } })
    : ev.mandate?.paymentMethodRef ? await prisma.sepaMandate.findFirst({ where: { provider: providerKey, providerPaymentMethodRef: ev.mandate.paymentMethodRef } }) : null;
  if (!m) return;
  if (ev.kind === "mandate.active") {
    if (m.status === "ACTIVE") return;
    await prisma.$transaction(async (tx) => {
      // One active mandate per customer: a new one replaces the old.
      await tx.sepaMandate.updateMany({ where: { companyId: m.companyId, status: "ACTIVE", id: { not: m.id } }, data: { status: "REVOKED", revokedAt: new Date() } });
      await tx.sepaMandate.update({
        where: { id: m.id },
        data: { status: "ACTIVE", signedAt: new Date(), holderName: ev.mandate?.holderName ?? m.holderName, ibanLast4: ev.mandate?.ibanLast4 ?? m.ibanLast4, providerCustomerRef: ev.mandate?.customerRef ?? m.providerCustomerRef, providerPaymentMethodRef: ev.mandate?.paymentMethodRef ?? m.providerPaymentMethodRef, providerMandateRef: ev.mandate?.mandateRef ?? m.providerMandateRef },
      });
    });
    const { notifyMandate } = await import("./notices");
    await notifyMandate(m.id, "active");
    return;
  }
  if (ev.kind === "mandate.failed" && m.status === "PENDING") await prisma.sepaMandate.update({ where: { id: m.id }, data: { status: "FAILED", failureReason: ev.failureReason ?? "Not completed" } });
  if (ev.kind === "mandate.revoked" && m.status === "ACTIVE") await prisma.sepaMandate.update({ where: { id: m.id }, data: { status: "REVOKED", revokedAt: new Date() } });
}

/** Ask the provider about an attempt in progress (MB WAY approval, direct debit settlement…). */
export async function pollRequest(requestId: string) {
  const r = await prisma.paymentRequest.findUnique({ where: { id: requestId }, include: { mandate: { select: { ibanLast4: true } } } });
  if (!r || !r.provider || !r.providerRef || !r.method || (r.status !== "PROCESSING" && r.status !== "OPEN")) return r?.status ?? null;
  const provider = providerByKey(r.provider);
  if (!provider?.poll) return r.status;
  const events = await provider.poll({ requestId: r.id, providerRef: r.providerRef, method: r.method as OnlineMethod, createdAt: r.createdAt, updatedAt: r.updatedAt, action: (r.action as PayAction | null) ?? null, ibanLast4: r.mandate?.ibanLast4 ?? null });
  for (const ev of events) await applyEvent(provider.key, ev);
  return (await prisma.paymentRequest.findUniqueOrThrow({ where: { id: r.id }, select: { status: true } })).status;
}

// ── direct debit mandates (customer side) ───────────────────────────────────

export async function myMandates(ctx: Ctx) {
  if (!can(ctx, ["buyer.payments.make", "buyer.payments.view"])) throw new ForbiddenError();
  return prisma.sepaMandate.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 10 });
}

/** Start signing a SEPA mandate with the provider (returns where to go). */
export async function startMandate(ctx: Ctx) {
  if (!can(ctx, "buyer.payments.make")) throw new ForbiddenError();
  const { methods } = await availableMethods(ctx.company.id);
  const provider = activeProvider();
  if (!provider || !methods.includes("DIRECT_DEBIT")) throw new ValidationError("Direct debit isn't available.");
  await prisma.sepaMandate.updateMany({ where: { companyId: ctx.company.id, status: "PENDING" }, data: { status: "FAILED", failureReason: "Replaced by a new attempt" } });
  const m = await prisma.sepaMandate.create({ data: { companyId: ctx.company.id, provider: provider.key, createdById: ctx.user.id } });
  try {
    const back = `${appUrl()}/buy/finance/direct-debit`;
    const res = await provider.setupMandate({ mandateId: m.id, payer: await partyFor(ctx.company.id), returnUrl: `${back}?return=1`, cancelUrl: back });
    await prisma.sepaMandate.update({ where: { id: m.id }, data: { setupRef: res.setupRef, providerCustomerRef: res.customerRef } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "mandate.started", entityType: "SepaMandate", entityId: m.id });
    return { mandateId: m.id, action: res.action };
  } catch (e) {
    await prisma.sepaMandate.update({ where: { id: m.id }, data: { status: "FAILED", failureReason: e instanceof Error ? e.message.slice(0, 300) : "error" } });
    if (e instanceof ProviderError) throw new AppError("PAYMENT_REFUSED", e.message, 422);
    throw e;
  }
}

export async function revokeMandate(ctx: Ctx, mandateId: string) {
  const m = await prisma.sepaMandate.findUnique({ where: { id: mandateId } });
  const staff = ctx.company.type === "ADMIN" && can(ctx, "admin.finance.manage");
  if (!m || (!staff && (m.companyId !== ctx.company.id || !can(ctx, "buyer.payments.make")))) throw new NotFoundError("Mandate");
  if (m.status !== "ACTIVE" && m.status !== "PENDING") throw new ValidationError("This direct debit isn't active.");
  await prisma.sepaMandate.update({ where: { id: m.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "mandate.revoked", entityType: "SepaMandate", entityId: m.id });
}

export async function setAutoCollect(ctx: Ctx, mandateId: string, on: boolean) {
  const m = await prisma.sepaMandate.findUnique({ where: { id: mandateId } });
  if (!m || m.companyId !== ctx.company.id || !can(ctx, "buyer.payments.make")) throw new NotFoundError("Mandate");
  await prisma.sepaMandate.update({ where: { id: m.id }, data: { autoCollect: on } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "mandate.auto_collect", entityType: "SepaMandate", entityId: m.id, after: { autoCollect: on } });
}

// ── refunds (FIRINGI finance) ───────────────────────────────────────────────

/** Refund customer credit (money not used on invoices) — through the provider when paid online. */
export async function refundCredit(ctx: Ctx, paymentId: string, amount: number, reason: string) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.finance.manage")) throw new ForbiddenError();
  if (!reason?.trim()) throw new ValidationError("Give a reason for the refund.");
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { allocations: { select: { amount: true } }, request: { select: { providerPaymentRef: true, provider: true } }, company: { select: { legalName: true } } } });
  if (!p || p.direction !== "INBOUND" || p.status !== "CONFIRMED") throw new NotFoundError("Payment");
  const amt = new Decimal(amount);
  const free = unallocated(p);
  if (amt.lte(0) || amt.gt(free.plus(0.004))) throw new ValidationError(`You can refund up to ${free.toFixed(2)} € (the part not used on invoices).`);
  const { approvalSettings, fourEyes } = await import("@/server/approvals/gate");
  const s = await approvalSettings();
  if (s.enabled && amt.gt(s.paymentAbove))
    await fourEyes(ctx, { kind: "PAYMENT", amount: amt.toNumber(), companyId: p.companyId, summary: `Refund to ${p.company.legalName}: ${amt.toFixed(2)} € — ${reason}`, payload: { refund: { paymentId, amount, reason } } });
  let refundRef: string | null = null;
  const provider = p.provider ? providerByKey(p.provider) : null;
  if (provider && p.request?.providerPaymentRef) {
    try { refundRef = (await provider.refund({ providerPaymentRef: p.request.providerPaymentRef, amount: amt.toFixed(2) })).refundRef; }
    catch (e) { throw new AppError("REFUND_FAILED", e instanceof Error ? e.message : String(e), 502); }
  }
  const newRefunded = D(p.refundedAmount).plus(amt);
  await prisma.payment.update({ where: { id: p.id }, data: { refundedAmount: newRefunded.toFixed(2), ...(newRefunded.gte(D(p.amount)) ? { status: "REFUNDED" } : {}) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "payment.refunded", entityType: "Payment", entityId: p.id, after: { amount: amt.toFixed(2), reason, refundRef, manual: !refundRef } });
  const { notifyRefund } = await import("./notices");
  await notifyRefund(p.companyId, amt.toFixed(2));
  return { refundRef, manual: !refundRef };
}

/** Cancelled before delivery: give a prepayment back (online → provider refund; otherwise it stays as credit). */
export async function refundOrderPrepayment(orderId: string) {
  const reqs = await prisma.paymentRequest.findMany({ where: { orderId, status: "PAID" }, include: { payment: { include: { allocations: { select: { amount: true } } } } } });
  let refunded = ZERO;
  for (const r of reqs) {
    if (!r.payment || r.payment.status !== "CONFIRMED") continue;
    const free = unallocated(r.payment);
    if (free.lte(0.004)) continue;
    const provider = r.provider ? providerByKey(r.provider) : null;
    if (!provider || !r.providerPaymentRef) continue;
    try {
      await provider.refund({ providerPaymentRef: r.providerPaymentRef, amount: free.toFixed(2) });
      const total = D(r.payment.refundedAmount).plus(free);
      await prisma.payment.update({ where: { id: r.payment.id }, data: { refundedAmount: total.toFixed(2), ...(total.gte(D(r.payment.amount)) ? { status: "REFUNDED" } : {}) } });
      await writeAudit({ actorUserId: null, actorCompanyId: r.companyId, action: "payment.prepayment_refunded", entityType: "Payment", entityId: r.payment.id, after: { orderId, amount: free.toFixed(2) } });
      refunded = refunded.plus(free);
    } catch (e) {
      const { notifyAttention } = await import("./notices");
      await notifyAttention(r.companyId, free.toFixed(2), `Automatic refund of a cancelled order's prepayment failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (refunded.gt(0)) {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { buyerCompanyId: true } });
    if (o) { const { notifyRefund } = await import("./notices"); await notifyRefund(o.buyerCompanyId, refunded.toFixed(2)); }
  }
  return refunded.toFixed(2);
}

// ── customer overview ───────────────────────────────────────────────────────

/** For the customer's invoices / payments pages: open invoices, what's being paid, credit, the mandate. */
export async function buyerPaymentOverview(ctx: Ctx) {
  if (!can(ctx, ["buyer.invoices.view", "buyer.payments.view", "buyer.payments.make"])) throw new ForbiddenError();
  const invoices = await prisma.invoice.findMany({
    where: { recipientCompanyId: ctx.company.id, docType: { in: [...INVOICE_TYPES] }, status: { not: "DRAFT" } },
    select: { id: true, fullNumber: true, providerNumber: true, dueAt: true, issuedAt: true, currencyCode: true, grossTotal: true, grossTotalLocal: true }, orderBy: [{ dueAt: "asc" }, { issuedAt: "asc" }], take: 500,
  });
  // Phase 45: open amounts in the invoice's own currency (what the customer pays)
  const localOpen = (i: (typeof invoices)[number], eur: Decimal) => (i.currencyCode !== "EUR" && i.grossTotalLocal && !D(i.grossTotal).isZero() ? eur.mul(D(i.grossTotalLocal)).div(D(i.grossTotal)).toFixed(i.currencyCode === "ISK" ? 0 : 2) : eur.toFixed(2));
  const open = await openAmounts(invoices.map((i) => i.id));
  const openInvoices = invoices.filter((i) => (open.get(i.id) ?? ZERO).gt(0.004));
  const [busyItems, credit, mandate, inProgress, methods] = await Promise.all([
    prisma.paymentRequestItem.findMany({ where: { invoiceId: { in: openInvoices.map((i) => i.id) }, request: { status: "PROCESSING" } }, select: { invoiceId: true } }),
    customerCredit(ctx.company.id),
    prisma.sepaMandate.findFirst({ where: { companyId: ctx.company.id, status: "ACTIVE" } }),
    prisma.paymentRequest.findMany({ where: { companyId: ctx.company.id, status: "PROCESSING" }, include: { items: { include: { invoice: { select: { fullNumber: true, providerNumber: true } } } }, order: { select: { number: true } } }, orderBy: { updatedAt: "desc" }, take: 20 }),
    availableMethods(ctx.company.id),
  ]);
  const busy = new Set(busyItems.map((b) => b.invoiceId));
  const now = new Date();
  return {
    canPay: can(ctx, "buyer.payments.make") && methods.methods.length > 0,
    invoices: openInvoices.map((i) => ({ id: i.id, number: i.providerNumber ?? i.fullNumber ?? "?", dueAt: i.dueAt?.toISOString() ?? null, overdue: !!i.dueAt && i.dueAt < now, open: localOpen(i, open.get(i.id)!), currency: i.currencyCode, busy: busy.has(i.id) })),
    credit: credit.filter((c) => !c.orderId || c.orderStatus === "CANCELLED" || c.orderStatus === "RETURNED").reduce((a, c) => a.plus(c.free), ZERO).toFixed(2),
    mandate: mandate ? { id: mandate.id, ibanLast4: mandate.ibanLast4, autoCollect: mandate.autoCollect } : null,
    inProgress: inProgress.map((r) => ({ id: r.id, method: r.method, amount: (r.amountLocal ?? r.amount).toFixed(2), currency: r.currencyCode, action: r.action as PayAction | null, docs: r.order ? r.order.number : r.items.map((i) => i.invoice.providerNumber ?? i.invoice.fullNumber ?? "?").join(", ") })),
  };
}
