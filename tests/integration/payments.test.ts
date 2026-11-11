/**
 * Phase 20: customer payments online with the simulated provider (no network):
 * card checkout → signed webhook → Payment matched to the invoice (once, however often the
 * webhook comes); MB WAY approved / declined on the phone; Multibanco reference with an
 * overpayment kept as credit and used on the next invoice; a payment already in progress
 * blocks a second one; SEPA mandate + direct debit collection (and a bounced one); pay-before-
 * shipping order held until paid, then sent to the supplier and its invoice paid by the
 * prepayment; a cancelled prepaid order is refunded; reminders sent once; unpaid orders cancelled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { paymentPolicy, setPaymentPolicy } from "@/server/services/payments";
import {
  applyEvent, buyerPayInvoices, buyerPayOrder, collectDue, customerCredit, openAmounts, pollRequest, receiveWebhook, refundCredit, startMandate, startPayment,
} from "@/server/payments/service";
import { simEvent, simSign } from "@/server/payments/sim";
import { simCheckout, simMultibancoPaid, simSignMandate } from "@/server/payments/sim-actions";
import { processPayments } from "@/server/payments/jobs";
import { WebhookError } from "@/server/payments/types";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test";
let savedEnv: string | undefined;
let savedPolicy: Awaited<ReturnType<typeof paymentPolicy>>;
let kebabId: string;

async function order(qty = 25) {
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await clearCart(kebab);
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  return placeOrder(kebab, { deliveryAddressId: addr.id });
}
async function deliver(id: string) {
  const lx = await ctxFor(LX);
  await confirmOrder(lx, id, {});
  for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (o.status !== "DELIVERED") await changeOrderStatus(lx, id, st).catch(async () => changeOrderStatus(await ctxFor(SA), id, st));
  }
  await new Promise((r) => setTimeout(r, 200));
  return prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] } } });
}
const deliveredInvoice = async (qty = 25) => deliver((await order(qty)).id);
/** Settle all of Kebab's open invoices (so credit isn't used up by older invoices from other test files). */
async function payAllOpen() {
  const all = await prisma.invoice.findMany({ where: { recipientCompanyId: kebabId, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] }, status: { not: "DRAFT" } }, select: { id: true } });
  const o = await openAmounts(all.map((i) => i.id));
  const ids = all.filter((i) => o.get(i.id)!.gt(0.004)).map((i) => i.id);
  if (!ids.length) return;
  await prisma.paymentRequest.updateMany({ where: { companyId: kebabId, status: { in: ["OPEN", "PROCESSING"] } }, data: { status: "CANCELLED" } });
  const req = await buyerPayInvoices(await ctxFor(KEBAB), ids);
  await startPayment(req.id, "MULTIBANCO", { via: "portal" });
  await simMultibancoPaid(req.id);
}
const open = async (invoiceId: string) => (await openAmounts([invoiceId])).get(invoiceId)!.toNumber();

beforeAll(async () => {
  savedEnv = process.env.PAYMENTS_SIMULATE;
  process.env.PAYMENTS_SIMULATE = "1";
  savedPolicy = await paymentPolicy();
  const sa = await ctxFor(SA);
  await setPaymentPolicy(sa, { ...savedPolicy, methods: { ...savedPolicy.methods, CARD: true, MB_WAY: true, MULTIBANCO: true, DIRECT_DEBIT: true }, mbWayPhone: null });
  kebabId = (await ctxFor(KEBAB)).company.id;
  savedTerms = await prisma.company.findUniqueOrThrow({ where: { id: kebabId }, select: { paymentTermsDays: true, creditLimit: true } });
  await prisma.company.update({ where: { id: kebabId }, data: { creditLimit: null, paymentTermsDays: 30 } });
});
let savedTerms: { paymentTermsDays: number; creditLimit: unknown } | null = null;
afterAll(async () => {
  await setPaymentPolicy(await ctxFor(SA), savedPolicy).catch(() => null);
  // Leave Kebab House as other test files expect it: nothing overdue, its own terms.
  await payAllOpen().catch(() => null);
  await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: false, ...(savedTerms ? { paymentTermsDays: savedTerms.paymentTermsDays, creditLimit: savedTerms.creditLimit as never } : {}) } });
  await prisma.sepaMandate.updateMany({ where: { companyId: kebabId }, data: { status: "REVOKED" } });
  process.env.PAYMENTS_SIMULATE = savedEnv;
});

describe("paying invoices online", () => {
  it("card: checkout → webhook → payment matched to the invoice, exactly once", async () => {
    const inv = await deliveredInvoice();
    const due = await open(inv.id);
    expect(due).toBeGreaterThan(0);
    const req = await buyerPayInvoices(await ctxFor(KEBAB), [inv.id]);
    expect(req.amount.toNumber()).toBe(due);
    const started = await startPayment(req.id, "CARD", { via: "portal" });
    expect(started.action).toMatchObject({ type: "redirect" });
    const r1 = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } });
    const body = simEvent("payment.succeeded", { requestId: req.id, providerRef: r1.providerRef, providerPaymentRef: "pi_1", amount: r1.amount.toString() });
    const headers = new Headers({ "x-sim-signature": simSign(body) });
    expect(await receiveWebhook("sim", body, headers)).toEqual({ received: 1, applied: 1 });
    expect(await receiveWebhook("sim", body, headers)).toEqual({ received: 1, applied: 0 }); // the provider retried
    const paid = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id }, include: { payment: { include: { allocations: true } } } });
    expect(paid.status).toBe("PAID");
    expect(paid.payment!.method).toBe("CARD");
    expect(paid.payment!.allocations.map((a) => a.invoiceId)).toEqual([inv.id]);
    expect(await open(inv.id)).toBe(0);
    expect(await prisma.payment.count({ where: { request: { id: req.id } } })).toBe(1);
    // A different event id for the same money (e.g. payment_intent.succeeded after checkout.session.completed) → still one payment.
    await applyEvent("sim", { eventId: "evt_other", type: "x", kind: "payment.succeeded", requestId: req.id, payload: {} });
    expect(await prisma.payment.count({ where: { companyId: kebabId, reference: "pi_1" } })).toBe(1);
    // The paid request can't be changed afterwards (database rule).
    await expect(prisma.paymentRequest.update({ where: { id: req.id }, data: { paidAmount: "1.00" } })).rejects.toThrow(/can't be changed/);
  });

  it("a wrong signature is refused", async () => {
    const body = simEvent("payment.succeeded", { requestId: "x" });
    await expect(receiveWebhook("sim", body, new Headers({ "x-sim-signature": "t=1,v1=" + "0".repeat(64) }))).rejects.toThrow(WebhookError);
    await expect(receiveWebhook("sim", body, new Headers({ "x-sim-signature": simSign(body + " ") }))).rejects.toThrow(/Bad signature/);
  });

  it("MB WAY: declined on the phone, then approved", async () => {
    const inv = await deliveredInvoice(20);
    const req = await buyerPayInvoices(await ctxFor(KEBAB), [inv.id]);
    await expect(startPayment(req.id, "MB_WAY", { via: "portal", phone: "12345" })).rejects.toThrow(/mobile number/);
    const s1 = await startPayment(req.id, "MB_WAY", { via: "portal", phone: "912 345 000" });
    expect(s1).toMatchObject({ status: "PROCESSING", action: { type: "mbway", phone: "912345000" } });
    expect(await pollRequest(req.id)).toBe("PROCESSING"); // waiting for the customer
    await prisma.$executeRaw`UPDATE "PaymentRequest" SET "updatedAt" = now() - interval '10 seconds' WHERE id = ${req.id}`;
    expect(await pollRequest(req.id)).toBe("FAILED");
    expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } })).failureReason).toMatch(/Declined/);
    await startPayment(req.id, "MB_WAY", { via: "portal", phone: "912345678" }); // tries again
    await prisma.$executeRaw`UPDATE "PaymentRequest" SET "updatedAt" = now() - interval '10 seconds' WHERE id = ${req.id}`;
    expect(await pollRequest(req.id)).toBe("PAID");
    expect(await open(inv.id)).toBe(0);
  });

  it("a payment in progress blocks a second one for the same invoice", async () => {
    const inv = await deliveredInvoice(20);
    const kebab = await ctxFor(KEBAB);
    const req = await buyerPayInvoices(kebab, [inv.id]);
    const s = await startPayment(req.id, "MULTIBANCO", { via: "portal" });
    expect(s.action).toMatchObject({ type: "multibanco", entity: "11249" });
    expect((s.action as { reference: string }).reference).toMatch(/^\d{3} \d{3} \d{3}$/);
    await expect(buyerPayInvoices(kebab, [inv.id])).rejects.toThrow(/already in progress/);
    await simMultibancoPaid(req.id);
    expect(await open(inv.id)).toBe(0);
    await expect(buyerPayInvoices(kebab, [inv.id])).rejects.toThrow(/already paid/);
  });

  it("paying more than is open leaves credit that pays the next invoice", async () => {
    await payAllOpen();
    const inv = await deliveredInvoice(20);
    const req = await buyerPayInvoices(await ctxFor(KEBAB), [inv.id]);
    await startPayment(req.id, "MULTIBANCO", { via: "portal" });
    await simMultibancoPaid(req.id, (req.amount.toNumber() + 50).toFixed(2));
    expect(await open(inv.id)).toBe(0);
    const credit = await customerCredit(kebabId);
    expect(credit.reduce((a, c) => a + c.free.toNumber(), 0)).toBeCloseTo(50, 2);
    const next = await deliveredInvoice(20); // invoiced on delivery → the credit is used at once
    const gross = next.grossTotal.toNumber();
    expect(await open(next.id)).toBeCloseTo(Math.max(0, gross - 50), 2);
    expect((await customerCredit(kebabId)).length).toBe(0);
    // Credit can be refunded only up to what is free (none left now).
    const sa = await ctxFor(SA);
    const p = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } });
    await expect(refundCredit(sa, p.paymentId!, 10, "test")).rejects.toThrow(/up to 0.00/);
  });
});

describe("SEPA direct debit", () => {
  it("mandate signed → invoices collected from it; a bounced debit fails and is reported", async () => {
    const kebab = await ctxFor(KEBAB);
    const { action } = await startMandate(kebab);
    expect(action).toMatchObject({ type: "redirect" });
    const m = await prisma.sepaMandate.findFirstOrThrow({ where: { companyId: kebabId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    await simSignMandate(m.setupRef!, "Karim Kebab", "PT50 0002 0123 1234 5678 9015 4");
    const active = await prisma.sepaMandate.findUniqueOrThrow({ where: { id: m.id } });
    expect(active).toMatchObject({ status: "ACTIVE", ibanLast4: "0154", holderName: "Karim Kebab" });

    const inv = await deliveredInvoice(20);
    const r = await collectDue(kebabId, [inv.id]);
    expect(r?.status).toBe("PROCESSING");
    const req = await prisma.paymentRequest.findFirstOrThrow({ where: { items: { some: { invoiceId: inv.id } }, source: "DIRECT_DEBIT" } });
    await prisma.$executeRaw`UPDATE "PaymentRequest" SET "updatedAt" = now() - interval '10 seconds' WHERE id = ${req.id}`;
    expect(await pollRequest(req.id)).toBe("PAID");
    expect(await open(inv.id)).toBe(0);

    // A new mandate on an account without money: the debit bounces.
    const again = await startMandate(kebab);
    const m2 = await prisma.sepaMandate.findFirstOrThrow({ where: { id: again.mandateId } });
    await simSignMandate(m2.setupRef!, "Karim Kebab", "PT50000201231234567890000");
    expect((await prisma.sepaMandate.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("REVOKED"); // replaced
    const inv2 = await deliveredInvoice(20);
    await collectDue(kebabId, [inv2.id]);
    const req2 = await prisma.paymentRequest.findFirstOrThrow({ where: { items: { some: { invoiceId: inv2.id } }, source: "DIRECT_DEBIT" } });
    await prisma.$executeRaw`UPDATE "PaymentRequest" SET "updatedAt" = now() - interval '10 seconds' WHERE id = ${req2.id}`;
    expect(await pollRequest(req2.id)).toBe("FAILED");
    expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req2.id } })).failureReason).toMatch(/AM04/);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "payment.attention" } })).toBeGreaterThan(0);
    expect(await open(inv2.id)).toBeGreaterThan(0);
    await prisma.sepaMandate.updateMany({ where: { companyId: kebabId }, data: { status: "REVOKED" } });
  });
});

describe("pay before shipping", () => {
  it("the order waits for payment, the supplier gets it once paid, the invoice is paid by the prepayment", async () => {
    await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: true } });
    const placed = await order(20);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(o).toMatchObject({ status: "ON_HOLD", awaitingPayment: true });
    const lx = await ctxFor(LX);
    await expect(confirmOrder(lx, o.id, {})).rejects.toThrow();
    const req = await buyerPayOrder(await ctxFor(KEBAB), o.id);
    expect(req.amount.toNumber()).toBe(o.grandTotal.toNumber());
    await startPayment(req.id, "CARD", { via: "portal" });
    const r = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } });
    await simCheckout(r.providerRef!, "succeeded");
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after).toMatchObject({ status: "PENDING_CONFIRMATION", awaitingPayment: false });
    const inv = await deliver(o.id);
    expect(await open(inv.id)).toBe(0); // paid by the prepayment
    await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: false } });
  });

  it("a prepaid order cancelled before delivery is refunded", async () => {
    await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: true } });
    const placed = await order(20);
    const req = await buyerPayOrder(await ctxFor(KEBAB), placed.id);
    await startPayment(req.id, "CARD", { via: "portal" });
    await simCheckout((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id } })).providerRef!, "succeeded");
    await changeOrderStatus(await ctxFor(LX), placed.id, "CANCELLED", "Out of stock");
    const p = await prisma.payment.findFirstOrThrow({ where: { request: { id: req.id } } });
    expect(p.status).toBe("REFUNDED");
    expect(p.refundedAmount.toNumber()).toBe(req.amount.toNumber());
    await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: false } });
  });

  it("an order left unpaid is cancelled after the set days", async () => {
    await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: true } });
    const placed = await order(20);
    await prisma.order.update({ where: { id: placed.id }, data: { placedAt: new Date(Date.now() - 5 * 86400_000) } });
    const res = await processPayments(new Date(new Date().setUTCHours(10)));
    expect(res.unpaidCancelled).toBeGreaterThanOrEqual(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("CANCELLED");
    await prisma.company.update({ where: { id: kebabId }, data: { payBeforeShipping: false } });
  });
});

describe("reminders", () => {
  it("before the due date and when overdue — each once, with a pay link", async () => {
    const inv = await deliveredInvoice(20);
    const at10 = new Date(new Date().setUTCHours(10, 0, 0, 0));
    await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(at10.getTime() + 2 * 86400_000) } });
    const before = await prisma.notificationMessage.count({ where: { eventKey: "payment.reminder_soon" } });
    await processPayments(at10);
    expect(await prisma.invoiceReminder.count({ where: { invoiceId: inv.id, kind: "soon" } })).toBe(1);
    const msgs = await prisma.notificationMessage.findMany({ where: { eventKey: "payment.reminder_soon" }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(await prisma.notificationMessage.count({ where: { eventKey: "payment.reminder_soon" } })).toBeGreaterThan(before);
    expect(msgs[0].link).toMatch(/\/pay\/[A-Za-z0-9_-]{20,}/);
    await processPayments(at10);
    expect(await prisma.invoiceReminder.count({ where: { invoiceId: inv.id } })).toBe(1); // not again
    // 15 days late: the 14-day step (the 7-day one was missed and is skipped).
    await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(at10.getTime() - 15 * 86400_000) } });
    await processPayments(at10);
    expect((await prisma.invoiceReminder.findMany({ where: { invoiceId: inv.id } })).map((r) => r.kind).sort()).toEqual(["overdue-14", "soon"]);
    // At night nothing is sent.
    await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(at10.getTime() - 31 * 86400_000) } });
    await processPayments(new Date(new Date(at10).setUTCHours(2)));
    expect(await prisma.invoiceReminder.count({ where: { invoiceId: inv.id, kind: "overdue-30" } })).toBe(0);
    await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(Date.now() + 30 * 86400_000) } });
  });
});
