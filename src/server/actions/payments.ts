"use server";
/** Online payments: customers paying (portal and public link), direct debit, FIRINGI finance tools. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, type ActionResult } from "./_action";
import { AppError, fromDbError, ValidationError } from "@/server/errors";
import { prisma } from "@/server/db";
import { notify } from "@/server/notify/dispatch";
import { writeAudit } from "@/server/services/audit";
import {
  buyerPayInvoices, buyerPayOrder, createRequest, pollRequest, refundCredit, revokeMandate, setAutoCollect, staffPaymentLink, startMandate, startPayment,
} from "@/server/payments/service";
import { activeProvider } from "@/server/payments/provider";
import { simCheckout, simMultibancoPaid, simSignMandate } from "@/server/payments/sim-actions";

const Method = z.enum(["CARD", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT"]);

/** For actions anyone holding the link may use (no sign-in): same error mapping as defineAction. */
async function publicAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const err = e instanceof AppError ? e : fromDbError(e);
    if (err) return { ok: false, code: err.code, error: err.message };
    console.error(e);
    return { ok: false, code: "INTERNAL", error: "Something went wrong. Please try again." };
  }
}

// ── customer (portal) ──
export const payInvoicesAction = defineAction({
  permission: "buyer.payments.make",
  schema: z.object({ invoiceIds: z.array(z.string()).min(1).max(100) }),
  handler: async (ctx, i) => ({ id: (await buyerPayInvoices(ctx, i.invoiceIds)).id }),
});

export const payOrderAction = defineAction({
  permission: ["buyer.payments.make", "buyer.orders.place"],
  schema: z.object({ orderId: z.string() }),
  handler: async (ctx, i) => ({ id: (await buyerPayOrder(ctx, i.orderId)).id }),
});

export const startPaymentAction = defineAction({
  permission: "buyer.payments.make",
  schema: z.object({ id: z.string(), method: Method, phone: z.string().max(20).optional() }),
  handler: async (ctx, i) => {
    const r = await prisma.paymentRequest.findUnique({ where: { id: i.id }, select: { companyId: true } });
    if (!r || r.companyId !== ctx.company.id) throw new ValidationError("Payment not found.");
    return startPayment(i.id, i.method, { phone: i.phone, via: "portal" });
  },
});

export const refreshPaymentAction = defineAction({
  permission: ["buyer.payments.make", "buyer.payments.view", "buyer.invoices.view"],
  schema: z.object({ id: z.string() }),
  handler: async (ctx, i) => {
    const r = await prisma.paymentRequest.findUnique({ where: { id: i.id }, select: { companyId: true } });
    if (!r || r.companyId !== ctx.company.id) throw new ValidationError("Payment not found.");
    return { status: await pollRequest(i.id) };
  },
});

export const startMandateAction = defineAction({
  permission: "buyer.payments.make",
  schema: z.object({}),
  handler: async (ctx) => startMandate(ctx),
});
export const revokeMandateAction = defineAction({
  permission: ["buyer.payments.make", "admin.finance.manage"],
  schema: z.object({ id: z.string() }),
  handler: async (ctx, i) => { await revokeMandate(ctx, i.id); revalidatePath("/buy/finance/direct-debit"); revalidatePath("/admin/finance/direct-debit"); return true; },
});
export const autoCollectAction = defineAction({
  permission: "buyer.payments.make",
  schema: z.object({ id: z.string(), on: z.boolean() }),
  handler: async (ctx, i) => { await setAutoCollect(ctx, i.id, i.on); revalidatePath("/buy/finance/direct-debit"); return true; },
});

// ── anyone with the pay link ──
async function byToken(token: string) {
  const r = await prisma.paymentRequest.findUnique({ where: { token } });
  if (!r) throw new ValidationError("This payment link isn't valid.");
  return r;
}
export async function startLinkPaymentAction(i: { token: string; method: "CARD" | "MB_WAY" | "MULTIBANCO" | "DIRECT_DEBIT"; phone?: string }) {
  return publicAction(async () => {
    const p = z.object({ token: z.string().min(20).max(64), method: Method, phone: z.string().max(20).optional() }).parse(i);
    const r = await byToken(p.token);
    if (p.method === "DIRECT_DEBIT") throw new ValidationError("Sign in to FIRINGI to pay by direct debit.");
    return startPayment(r.id, p.method, { phone: p.phone, via: "link" });
  });
}
export async function refreshLinkPaymentAction(i: { token: string }) {
  return publicAction(async () => ({ status: await pollRequest((await byToken(String(i.token))).id) }));
}
/** An expired / replaced link: a fresh one for what is still open on the same invoices. */
export async function renewLinkAction(i: { token: string }) {
  return publicAction(async () => {
    const r = await prisma.paymentRequest.findUnique({ where: { token: String(i.token) }, include: { items: true } });
    if (!r || r.status === "PAID" || r.status === "PROCESSING" || r.orderId) throw new ValidationError("This payment link isn't valid.");
    const fresh = await createRequest({ companyId: r.companyId, invoiceIds: r.items.map((x) => x.invoiceId), source: "REMINDER", expiresInHours: 72 });
    return { token: fresh.token };
  });
}

// ── simulated provider pages (development / demo only) ──
export async function simCheckoutAction(i: { ref: string; outcome: "succeeded" | "failed" }) {
  return publicAction(async () => {
    const r = await simCheckout(String(i.ref), i.outcome === "failed" ? "failed" : "succeeded");
    return { back: r.source === "BUYER" || r.source === "ORDER" ? `/buy/finance/pay/${r.id}?return=1` : `/pay/${r.token}?return=1` };
  });
}
export async function simSignMandateAction(i: { setupRef: string; holder: string; iban: string }) {
  return publicAction(async () => { await simSignMandate(String(i.setupRef), String(i.holder), String(i.iban)); return { back: "/buy/finance/direct-debit?return=1" }; });
}

// ── FIRINGI finance ──
export const paymentLinkAction = defineAction({
  permission: ["admin.finance.manage", "admin.invoices.view"],
  schema: z.object({ companyId: z.string(), invoiceIds: z.array(z.string()).optional(), send: z.boolean().default(false) }),
  handler: async (ctx, i) => {
    const r = await staffPaymentLink(ctx, i.companyId, i.invoiceIds);
    if (i.send) {
      const docs = await prisma.paymentRequestItem.findMany({ where: { requestId: r.id }, include: { invoice: { select: { fullNumber: true, providerNumber: true } } } });
      await notify("payment.link", [{ companyId: i.companyId, link: `/pay/${r.token}` }], { total: Number(r.amount), documents: docs.map((d) => d.invoice.providerNumber ?? d.invoice.fullNumber).join(", ") }, { ref: { type: "PaymentRequest", id: r.id } });
    }
    revalidatePath("/admin/finance/online-payments");
    return { url: r.url, amount: r.amount.toString() };
  },
});

export const cancelRequestAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({ id: z.string() }),
  handler: async (ctx, i) => {
    const res = await prisma.paymentRequest.updateMany({ where: { id: i.id, status: "OPEN" }, data: { status: "CANCELLED" } });
    if (!res.count) throw new ValidationError("Only payment requests not started yet can be cancelled.");
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "payment.request_cancelled", entityType: "PaymentRequest", entityId: i.id });
    revalidatePath("/admin/finance/online-payments");
    return true;
  },
});

export const refundCreditAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({ paymentId: z.string(), amount: z.coerce.number().positive(), reason: z.string().min(2).max(300) }),
  handler: async (ctx, i) => { const r = await refundCredit(ctx, i.paymentId, i.amount, i.reason); revalidatePath("/admin/finance/online-payments"); return r; },
});

export const simMultibancoPaidAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({ id: z.string() }),
  handler: async (_ctx, i) => { await simMultibancoPaid(i.id); revalidatePath("/admin/finance/online-payments"); return true; },
});

export const testProviderAction = defineAction({
  permission: ["admin.finance.manage", "admin.settings.manage"],
  schema: z.object({}),
  handler: async () => { const p = activeProvider(); return p ? await p.check() : { ok: false, detail: "No payment provider configured" }; },
});

export const payBeforeShippingAction = defineAction({
  permission: ["admin.customers.manage", "admin.finance.manage"],
  schema: z.object({ companyId: z.string(), on: z.boolean() }),
  handler: async (ctx, i) => {
    const c = await prisma.company.findUnique({ where: { id: i.companyId }, select: { type: true, payBeforeShipping: true } });
    if (!c || (c.type !== "CUSTOMER" && c.type !== "WHOLESALER")) throw new ValidationError("Only customers and wholesalers buy.");
    await prisma.company.update({ where: { id: i.companyId }, data: { payBeforeShipping: i.on } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.pay_before_shipping", entityType: "Company", entityId: i.companyId, before: { on: c.payBeforeShipping }, after: { on: i.on } });
    revalidatePath(`/admin/customers/${i.companyId}`);
    return true;
  },
});
