/**
 * Phase 18: certified invoicing through Moloni (simulated Moloni — no network) and supplier
 * payouts due. A delivered order is booked by FIRINGI at once and issued at Moloni by the queue
 * (customer + products created once, Moloni's number / hash stored); credit notes point at the
 * invoice's lines and wait for it; Moloni down → retries; refused → FAILED + finance alerted;
 * never issued twice; the legal number can't be changed. Payouts: overdue / soon, daily reminder.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { issueCreditNote, recordPayment } from "@/server/services/finance";
import { fiscalSettings, moloniOptions, processFiscalQueue, retryFiscal, saveFiscalSettings, fiscalize, type FiscalSettings } from "@/server/invoicing/fiscal";
import { setMoloniFetchForTests } from "@/server/invoicing/moloni/client";
import { moloniSim, simulatedMoloni } from "@/server/invoicing/moloni/sim";
import { duePayouts, remindDuePayouts } from "@/server/services/payouts";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", FIN = "finance@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test";
let original: FiscalSettings;

/** Kebab House orders mozzarella from Lisboa Central; the supplier delivers it → FIRINGI invoices. */
async function deliveredOrder(qty = 30) {
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await clearCart(kebab);
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
  await confirmOrder(lx, id, {});
  for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (o.status !== "DELIVERED") await changeOrderStatus(lx, id, st).catch(() => {});
  }
  // Let the after-delivery kick (fire-and-forget) finish before the test drives the queue itself.
  await new Promise((r) => setTimeout(r, 300));
  return prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" } });
}

beforeAll(async () => { original = await fiscalSettings(); });
afterAll(async () => {
  setMoloniFetchForTests(null);
  await prisma.setting.updateMany({ where: { key: "invoicing.provider" }, data: { value: original as never } });
  await prisma.$disconnect();
});

describe("Moloni connection and settings", () => {
  it("without Moloni keys the provider can't be switched on", async () => {
    setMoloniFetchForTests(null);
    delete process.env.MOLONI_SIMULATE;
    const sa = await ctxFor(SA);
    const o = await moloniOptions(sa);
    expect(o.ok).toBe(false);
    await expect(saveFiscalSettings(sa, { ...original, provider: "moloni" })).rejects.toThrow(/not connected/);
  });

  it("connected: options are read from Moloni, VAT rates suggested; incomplete settings refused; only settings managers", async () => {
    moloniSim.reset();
    setMoloniFetchForTests(simulatedMoloni);
    const sa = await ctxFor(SA);
    const o = await moloniOptions(sa);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.sets?.[0].id).toBe(11);
    expect(o.suggestedTaxMap?.["23.000"]).toBe(1);
    await expect(saveFiscalSettings(sa, { provider: "moloni", moloni: { ...original.moloni, companyId: o.companyId! } })).rejects.toThrow(/Choose these Moloni settings/);
    await expect(saveFiscalSettings(await ctxFor("sales@firingi.test"), { provider: "internal", moloni: original.moloni })).rejects.toThrow();
    const s = await saveFiscalSettings(sa, {
      provider: "moloni",
      moloni: { companyId: moloniSim.companyId, invoiceSetId: 11, creditNoteSetId: 11, maturityDateId: 21, paymentMethodId: 31, categoryId: 51, unitId: 41, exemptionReason: "M99", taxMap: o.suggestedTaxMap ?? {} },
    });
    expect(s.provider).toBe("moloni");
  });
});

describe("issuing at Moloni", () => {
  let invoiceId = "";

  it("a delivered order is booked at once, then issued at Moloni by the queue", async () => {
    moloniSim.failNext("UNAVAILABLE"); // the after-delivery kick finds Moloni down
    const inv = await deliveredOrder();
    invoiceId = inv.id;
    const booked = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(booked.status).toBe("ISSUED");
    expect(booked.fullNumber).toMatch(/^FT-REF FIR\d{4}\/\d+$/); // FIRINGI reference; Moloni gives the legal number
    expect(["PENDING"]).toContain(booked.fiscalStatus);
    expect(booked.providerNumber).toBeNull();

    // Moloni was down: it waits with a back-off; once due again the queue issues it.
    await prisma.invoice.update({ where: { id: inv.id }, data: { fiscalNextAt: new Date(Date.now() - 1000) } });
    const r = await processFiscalQueue();
    expect(r.done).toBeGreaterThanOrEqual(1);
    const done = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(done.fiscalStatus).toBe("DONE");
    expect(done.providerNumber).toMatch(/^SIM FT SIM\/\d+$/);
    expect(done.externalProvider).toBe("moloni-simulated");
    expect(done.hash).toMatch(/^SIMHASH/);
    const data = done.providerData as { documentId: number; lineIds: number[]; totals: { gross: number } };
    expect(data.lineIds.length).toBe(await prisma.invoiceLine.count({ where: { invoiceId: inv.id } }));
    expect(Math.abs(data.totals.gross - Number(done.grossTotal))).toBeLessThanOrEqual(0.01);

    // What was sent: customer by NIF, product by SKU, closed document with our reference.
    const sent = moloniSim.calls();
    const ins = sent.find((c) => c.endpoint === "invoices/insert")!.body as { status: number; our_reference: string; products: { taxes: { tax_id: number }[] }[] };
    expect(ins.status).toBe(1);
    expect(ins.our_reference).toBe(done.fullNumber);
    expect(ins.products[0].taxes[0].tax_id).toBeGreaterThan(0);
    expect(sent.filter((c) => c.endpoint === "customers/insert")).toHaveLength(1);
  });

  it("the same customer and product are not created twice", async () => {
    const inv = await deliveredOrder(25);
    await prisma.invoice.updateMany({ where: { id: inv.id, fiscalStatus: "PENDING" }, data: { fiscalNextAt: null } });
    await processFiscalQueue();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).fiscalStatus).toBe("DONE");
    expect(moloniSim.calls().filter((c) => c.endpoint === "customers/insert")).toHaveLength(1);
    expect(moloniSim.calls().filter((c) => c.endpoint === "products/insert" && (c.body as { reference: string }).reference === "FIR-MOZZ2")).toHaveLength(1);
    expect(await fiscalize(inv.id)).toBe("DONE"); // nothing left to do
  });

  it("never issued twice: Moloni accepted it but FIRINGI didn't hear back → the retry finds it", async () => {
    moloniSim.failNext("UNAVAILABLE"); // the after-delivery kick
    const inv = await deliveredOrder(26);
    const before = moloniSim.calls().filter((c) => c.endpoint === "invoices/insert").length;
    // Known customer + product: getAll (check), insert (accepted), getOne (lost) …
    moloniSim.failNext(null, null, "UNAVAILABLE");
    await prisma.invoice.update({ where: { id: inv.id }, data: { fiscalNextAt: null } });
    await processFiscalQueue();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).fiscalStatus).toBe("PENDING");
    expect(moloniSim.calls().filter((c) => c.endpoint === "invoices/insert").length).toBe(before + 1);
    // … the retry reuses Moloni's document instead of issuing a second one.
    await prisma.invoice.update({ where: { id: inv.id }, data: { fiscalNextAt: null } });
    await processFiscalQueue();
    const done = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(done.fiscalStatus).toBe("DONE");
    expect(moloniSim.calls().filter((c) => c.endpoint === "invoices/insert").length).toBe(before + 1);
  });

  it("the legal number and a DONE state can't be changed afterwards (database rule)", async () => {
    await expect(prisma.invoice.update({ where: { id: invoiceId }, data: { providerNumber: "FT X/1" } })).rejects.toThrow(/INVOICE_IMMUTABLE/);
    await expect(prisma.invoice.update({ where: { id: invoiceId }, data: { fiscalStatus: "PENDING" } })).rejects.toThrow(/INVOICE_IMMUTABLE/);
  });

  it("a credit note points at the invoice's lines at Moloni", async () => {
    const sa = await ctxFor(SA);
    const lines = await prisma.invoiceLine.findMany({ where: { invoiceId }, orderBy: { position: "asc" } });
    const cn = await issueCreditNote(sa, invoiceId, { lines: [{ invoiceLineId: lines[0].id, qty: 1 }], reason: "One block damaged" });
    await new Promise((r) => setTimeout(r, 200));
    await prisma.invoice.updateMany({ where: { id: cn.id, fiscalStatus: "PENDING" }, data: { fiscalNextAt: null } });
    await processFiscalQueue();
    const done = await prisma.invoice.findUniqueOrThrow({ where: { id: cn.id } });
    expect(done.fiscalStatus).toBe("DONE");
    expect(done.providerNumber).toMatch(/^SIM NC SIM\/\d+$/);
    const orig = (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).providerData as { documentId: number; lineIds: number[] };
    const body = moloniSim.calls().filter((c) => c.endpoint === "creditNotes/insert").pop()!.body as { associated_documents: { associated_id: number }[]; products: { related_id: number }[] };
    expect(body.associated_documents[0].associated_id).toBe(orig.documentId);
    expect(body.products[0].related_id).toBe(orig.lineIds[0]);
  });

  it("a credit note waits until its invoice is at Moloni", async () => {
    moloniSim.failNext("UNAVAILABLE"); // the after-delivery kick: the invoice stays pending
    const inv = await deliveredOrder(22);
    const sa = await ctxFor(SA);
    const cn = await issueCreditNote(sa, inv.id, { lines: "ALL", reason: "Wrong product" });
    await new Promise((r) => setTimeout(r, 200));
    // Only the credit note is due: it must wait for the invoice.
    await prisma.invoice.update({ where: { id: inv.id }, data: { fiscalNextAt: new Date(Date.now() + 3600_000) } });
    await prisma.invoice.updateMany({ where: { id: cn.id }, data: { fiscalNextAt: null } });
    await processFiscalQueue();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: cn.id } })).fiscalStatus).toBe("PENDING");
    // Both due: invoice first, then the credit note.
    for (let i = 0; i < 2; i++) {
      await prisma.invoice.updateMany({ where: { id: { in: [inv.id, cn.id] }, fiscalStatus: "PENDING" }, data: { fiscalNextAt: null } });
      await processFiscalQueue();
    }
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).fiscalStatus).toBe("DONE");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: cn.id } })).fiscalStatus).toBe("DONE");
  });

  it("Moloni refuses a document → FAILED, finance alerted; retry after the fix", async () => {
    moloniSim.failNext("UNAVAILABLE"); // the kick
    const inv = await deliveredOrder(21);
    await prisma.invoice.update({ where: { id: inv.id }, data: { fiscalNextAt: null } });
    moloniSim.failNext("VALIDATION");
    await processFiscalQueue();
    const failed = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(failed.fiscalStatus).toBe("FAILED");
    expect(failed.fiscalError).toMatch(/document_set_id/);
    expect(await prisma.notification.count({ where: { type: "invoicing.failed", user: { email: FIN } } })).toBeGreaterThan(0);
    await expect(retryFiscal(await ctxFor("sales@firingi.test"), inv.id)).rejects.toThrow();
    expect(await retryFiscal(await ctxFor(SA), inv.id)).toBe("DONE");
  });

  it("with the internal provider nothing goes to Moloni", async () => {
    const sa = await ctxFor(SA);
    await saveFiscalSettings(sa, { ...(await fiscalSettings()), provider: "internal" });
    const inv = await deliveredOrder(20);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.fiscalStatus).toBe("LOCAL");
    expect(row.hash).toBeTruthy();
  });
});

describe("supplier payouts due", () => {
  it("lists approved supplier invoices by due date; a payout reduces what is open; one reminder a day", async () => {
    const fin = await ctxFor(FIN);
    const lx = await ctxFor(LX);
    const day = 86400_000;
    const tag = Date.now().toString(36);
    const overdue = await prisma.vendorInvoice.create({ data: { vendorCompanyId: lx.company.id, externalNumber: `LX-OVD-${tag}`, issueDate: new Date(Date.now() - 40 * day), netTotal: 100, vatTotal: 23, grossTotal: 123, fileKey: "test", status: "APPROVED" } });
    const soon = await prisma.vendorInvoice.create({ data: { vendorCompanyId: lx.company.id, externalNumber: `LX-SOON-${tag}`, issueDate: new Date(), dueDate: new Date(Date.now() + 2 * day), netTotal: 50, vatTotal: 11.5, grossTotal: 61.5, fileKey: "test", status: "APPROVED" } });
    const d = await duePayouts(fin);
    const o = d.overdue.find((r) => r.id === overdue.id)!;
    expect(o.daysLeft).toBe(-10); // no due date: invoice date + 30 days (policy)
    expect(o.open).toBe(123);
    expect(d.soon.some((r) => r.id === soon.id && r.daysLeft === 2)).toBe(true);
    expect(d.bySupplier.find((g) => g.vendorId === lx.company.id)!.overdue).toBeGreaterThanOrEqual(123);

    await recordPayment(fin, { direction: "OUTBOUND", companyId: lx.company.id, method: "BANK_TRANSFER", amount: 23, reference: "test", paidAt: new Date(), allocations: [{ documentId: overdue.id, amount: 23 }] });
    expect((await duePayouts(fin)).overdue.find((r) => r.id === overdue.id)!.open).toBe(100);

    await prisma.setting.deleteMany({ where: { key: "payouts.reminded" } });
    const r1 = await remindDuePayouts();
    expect(r1.sent).toBe(true);
    expect(await prisma.notification.count({ where: { type: "payout.due", user: { email: FIN } } })).toBeGreaterThan(0);
    expect((await remindDuePayouts()).sent).toBe(false); // once a day
    await expect(duePayouts(await ctxFor("sales@firingi.test"))).rejects.toThrow();

    // leave the payable list as it was
    await prisma.vendorInvoice.updateMany({ where: { id: { in: [overdue.id, soon.id] } }, data: { status: "PAID" } });
  });
});
