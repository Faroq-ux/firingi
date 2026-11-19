/**
 * Phase 46: e-invoicing — FIRINGI Polska's invoices to a Polish customer go to KSeF (mandatory route), in Polish with
 * the customer's chosen English as second language; a supplier with a self-billing agreement gets its invoice issued
 * by FIRINGI; a supplier's own e-invoice arrives and is matched to its statement. Peppol for Portugal on request,
 * checks that stop a document until it is fixed, outages with retries, rejections, Factur-X by e-mail, the archive
 * and the auditor export, and every switch.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { addToCart, clearCart } from "@/server/services/cart";
import { issueServiceInvoice } from "@/server/invoicing/service";
import * as E from "@/server/einvoice/service";
import * as M from "@/server/einvoice/monthly";
import { invoicePdfData } from "@/server/data/finance-docs";
import { renderInvoicePdf } from "@/server/pdf/documents";
import { selfBilledPdfData } from "@/server/einvoice/pdf";
import { readStored } from "@/server/services/storage";
import { DEFAULT_EINVOICE_SETTINGS, type EInvoiceSettings } from "@/lib/einvoice";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", KK = "owner@kebabkrakow.test", HK = "owner@hurtownia.test", KH = "owner@kebabhouse.test";
let savedSettings: unknown = null;
const placed: string[] = [];
const profiles: string[] = [];
let ptEntityId = "", ptWholesalerId = "";
let savedEntities: { id: string; peppolId: string | null }[] = [];

const settings = async (patch: Partial<EInvoiceSettings> = {}) => E.saveEInvoiceSettings(await ctxFor(SA), { ...DEFAULT_EINVOICE_SETTINGS, ...patch });
const route = (cc: string, r: Partial<EInvoiceSettings["countries"][string]>) => ({ ...DEFAULT_EINVOICE_SETTINGS.countries, [cc]: { ...DEFAULT_EINVOICE_SETTINGS.countries[cc], ...r } });
async function profile(email: string, p: Partial<E.ProfileInput>) {
  const ctx = await ctxFor(email);
  profiles.push(ctx.company.id);
  return E.saveProfile(await ctxFor(SA), { delivery: "BOTH", peppolId: null, invoiceLanguage: null, secondLanguage: null, ksefNip: null, sdiCode: null, pecEmail: null, leitwegId: null, invoiceEmail: null, ...p }, ctx.company.id);
}
const offerOf = async (sku: string) => {
  const hk = await ctxFor(HK);
  return prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: hk.company.id, status: "ACTIVE", packaging: { variant: { sku } } } });
};
async function deliverPl(items: [string, number][]) {
  const kk = await ctxFor(KK);
  await clearCart(kk);
  for (const [sku, qty] of items) await addToCart(kk, (await offerOf(sku)).id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kk.company.id, kind: "DELIVERY", isActive: true } });
  const r = await placeOrder(kk, { deliveryAddressId: addr.id });
  const id = "orders" in r ? r.orders[0].id : (r as { id: string }).id;
  placed.push(id);
  const hk = await ctxFor(HK);
  await confirmOrder(hk, id, {});
  for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (o.status !== "DELIVERED") await changeOrderStatus(hk, id, st).catch(async () => changeOrderStatus(await ctxFor(SA), id, st));
  }
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" } });
  const statement = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { orderId: id, isCreditStatement: false } });
  return { orderId: id, invoice, statement };
}
const docOf = (invoiceId: string) => prisma.eInvoiceDocument.findFirstOrThrow({ where: { invoiceId, direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } });
const run = async () => { await new Promise((r) => setTimeout(r, 150)); return E.processEInvoiceQueue(100); };
/** The background send right after a delivery may hold a document for a moment: run the queue until it moves on. */
async function settle<T extends { status: string }>(get: () => Promise<T>, until: (s: string) => boolean = (s) => s !== "QUEUED"): Promise<T> {
  let d = await get();
  for (let i = 0; i < 40 && !until(d.status); i++) { await run(); d = await get(); if (!until(d.status)) await new Promise((r) => setTimeout(r, 150)); }
  return d;
}
async function serviceInvoice(companyId: string, net = 25) {
  return prisma.$transaction((tx) => issueServiceInvoice(tx, { recipientCompanyId: companyId, docType: "INVOICE", dueDays: 15, actorUserId: null, lines: [{ description: "Publicidade FIRINGI — carregamento de saldo pré-pago", net: new Decimal(net) }] }));
}

beforeAll(async () => {
  savedSettings = (await prisma.setting.findFirst({ where: { key: "einvoice.settings" } }))?.value ?? null;
  await settings();
  ptEntityId = (await prisma.legalEntity.findFirstOrThrow({ where: { country: { code: "PT" }, isActive: true } })).id;
  savedEntities = await prisma.legalEntity.findMany({ select: { id: true, peppolId: true } });
  await prisma.legalEntity.update({ where: { id: ptEntityId }, data: { peppolId: null } }); // the check that stops a document needs it missing
  // a Portuguese wholesaler with no e-invoice profile yet (the demo gives one of them a Peppol id)
  ptWholesalerId = (await prisma.company.findFirstOrThrow({ where: { type: "WHOLESALER", country: { code: "PT" }, status: "APPROVED", einvoiceProfile: { is: null } }, orderBy: { createdAt: "asc" } })).id;
  const kk = await ctxFor(KK);
  await prisma.company.update({ where: { id: kk.company.id }, data: { creditLimit: null, paymentTermsDays: 30, payBeforeShipping: false } });
});

afterAll(async () => {
  const sa = await ctxFor(SA);
  for (const id of placed) await changeOrderStatus(sa, id, "CANCELLED", "test clean-up").catch(() => null);
  await prisma.eInvoiceMonthlyPack.deleteMany({ where: { companyId: { in: profiles } } });
  await prisma.eInvoiceProfile.deleteMany({ where: { companyId: { in: profiles } } });
  await prisma.legalEntity.updateMany({ data: { language: null, secondLanguage: null, requireOwnLanguage: true } });
  for (const e of savedEntities) await prisma.legalEntity.update({ where: { id: e.id }, data: { peppolId: e.peppolId } });
  await prisma.setting.deleteMany({ where: { key: "einvoice.settings" } });
  if (savedSettings) await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: "einvoice.settings", value: savedSettings as never } });
  await prisma.$disconnect();
});

describe("Poland: KSeF, languages, PDF", () => {
  let invoiceId = "";

  it("the customer's country decides the language; its own choice is printed as the second language", async () => {
    await profile(KK, { invoiceLanguage: "en" });
    const { invoice } = await deliverPl([["FIR-COLA33", 6]]);
    invoiceId = invoice.id;
    expect(invoice.language).toBe("pl");
    expect(invoice.secondLanguage).toBe("en");
  });

  it("KSeF is mandatory in Poland: queued, checked, archived with its hash, sent and cleared", async () => {
    const d0 = await docOf(invoiceId);
    expect(d0).toMatchObject({ kind: "INVOICE", format: "KSEF_FA3", provider: "ksef", channel: "KSEF", countryCode: "PL" });
    expect(["QUEUED", "SENT", "ACCEPTED"]).toContain(d0.status);
    let d = await settle(() => docOf(invoiceId));
    expect(["SENT", "ACCEPTED"]).toContain(d.status);
    expect(d.networkRef).toMatch(/-EE-/);
    expect(d.xmlKey).toBeTruthy();
    const xml = (await readStored(d.xmlKey!)).toString("utf8");
    expect(xml).toContain("<NIP>5213999999</NIP>");
    expect(xml).toContain("<NIP>6793108059</NIP>");
    expect(xml).toContain("<KodWaluty>PLN</KodWaluty>");
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(xml).toContain(`<P_15>${new Decimal(inv.grossTotalLocal!.toString()).toFixed(2)}</P_15>`);
    const det = await E.documentDetail(await ctxFor(SA), d.id);
    expect(det.intact).toBe(true);
    d = await settle(() => docOf(invoiceId), (s) => s === "ACCEPTED");
    expect(d.status).toBe("ACCEPTED");
    const ev = await prisma.eInvoiceEvent.findMany({ where: { documentId: d.id } });
    expect(ev.map((e) => e.status)).toEqual(expect.arrayContaining(["QUEUED", "SENT", "ACCEPTED"]));
    // the e-mail copy carries the PDF and the XML (for the customer's accountant)
    expect(ev.some((e) => /Copy e-mailed to .+ \(PDF \+ XML\)/.test(e.message))).toBe(true);
  });

  it("the invoice PDF is in Polish with English beside it, carries the KSeF reference, and renders", async () => {
    const data = await invoicePdfData(null, invoiceId);
    expect(data.language).toBe("pl");
    expect(data.secondLanguage).toBe("en");
    expect(data.einvoice?.format).toBe("KSEF_FA3");
    expect(data.einvoice?.networkRef).toBeTruthy();
    const pdf = await renderInvoicePdf(data);
    expect(pdf.length).toBeGreaterThan(2000);
    // the customer sees the status and can fetch the XML
    const kk = await ctxFor(KK);
    const m = await E.myEInvoiceStatus(kk, [invoiceId]);
    expect(m.get(invoiceId)?.status).toBe("ACCEPTED");
    const f = await E.documentFile(kk, m.get(invoiceId)!.id, "xml");
    expect(f.buf.toString("utf8")).toContain("<Faktura");
    await expect(E.documentFile(await ctxFor(HK), m.get(invoiceId)!.id, "xml")).rejects.toThrow();
  });
});

describe("self-billing and supplier e-invoices", () => {
  it("a supplier with a self-billing agreement gets its invoice issued by FIRINGI: numbered, recorded, matched, sent to KSeF", async () => {
    await profile(HK, { selfBilling: true });
    const { statement } = await deliverPl([["FIR-COLA33", 5]]);
    const st = await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: statement.id } });
    expect(st.selfBilledNumber).toMatch(/^AF 6762495634 \d{4}\/\d+$/);
    expect(st.status).toBe("MATCHED");
    const vi = await prisma.vendorInvoice.findFirstOrThrow({ where: { externalNumber: st.selfBilledNumber! } });
    expect(vi).toMatchObject({ source: "SELF_BILLED", status: "MATCHED", currencyCode: "PLN" });
    const d = await settle(() => prisma.eInvoiceDocument.findFirstOrThrow({ where: { statementId: st.id, kind: "SELF_BILLED" } }));
    expect(["SENT", "ACCEPTED"]).toContain(d.status);
    const xml = (await readStored(d.xmlKey!)).toString("utf8");
    expect(xml).toContain("<P_17>1</P_17>");
    expect(xml).toContain("<NIP>6762495634</NIP>");
    const pdf = await selfBilledPdfData(st.id);
    expect(pdf.selfBilled).toBe(true);
    expect(pdf.legalTexts).toContain("samofakturowanie");
    expect((await renderInvoicePdf(pdf)).length).toBeGreaterThan(2000);
  });

  it("a supplier's own e-invoice arrives through the network and is matched to its statement (once)", async () => {
    await profile(HK, { selfBilling: false });
    const { statement } = await deliverPl([["FIR-COLA33", 7]]);
    expect((await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: statement.id } })).status).toBe("OPEN");
    const d = await E.simulateSupplierEInvoice(await ctxFor(SA), statement.id);
    expect(d?.status).toBe("MATCHED");
    expect(d?.direction).toBe("INBOUND");
    const vi = await prisma.vendorInvoice.findUniqueOrThrow({ where: { id: d!.vendorInvoiceId! } });
    expect(vi).toMatchObject({ source: "EINVOICE", status: "MATCHED" });
    expect((await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: statement.id } })).status).toBe("MATCHED");
    const again = await E.simulateSupplierEInvoice(await ctxFor(SA), statement.id);
    expect(again?.id).toBe(d!.id);
  });

  it("an e-invoice with different amounts is recorded as disputed; an unknown sender waits for review", async () => {
    const { statement } = await deliverPl([["FIR-COLA33", 4]]);
    const d = await E.simulateSupplierEInvoice(await ctxFor(SA), statement.id, { netDelta: 10, number: "X1" });
    expect(d?.status).toBe("RECEIVED");
    expect(d?.responseNote).toMatch(/differ/);
    expect((await prisma.vendorInvoice.findUniqueOrThrow({ where: { id: d!.vendorInvoiceId! } })).status).toBe("DISPUTED");
    const stranger = await E.receiveSupplierXml(
      '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:ID>Z-1</cbc:ID><cbc:IssueDate>2026-11-19</cbc:IssueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>DE999999999</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount>10</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>12</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>',
      { provider: "peppol-ap", externalId: "test-stranger-1" },
    );
    expect(stranger?.status).toBe("RECEIVED");
    expect(JSON.stringify(stranger?.validation)).toContain("IN-02");
  });
});

describe("Peppol on request, checks, outages, rejections", () => {
  it("Portugal's route is on request: no Peppol id → no e-invoice; a customer who only wants e-mail never gets one", async () => {
    const inv = await serviceInvoice(ptWholesalerId);
    expect(await prisma.eInvoiceDocument.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect(inv.language).toBe("pt-PT");
    expect(inv.secondLanguage).toBeNull();
  });

  it("a Peppol id queues it; a missing FIRINGI Peppol id stops it (checks) until finance fixes it and sends it again", async () => {
    const wh = await prisma.company.findUniqueOrThrow({ where: { id: ptWholesalerId }, include: { memberships: { include: { user: true }, where: { isOwner: true } } } });
    await profile(wh.memberships[0].user.email, { peppolId: "9946:PT500000000" });
    const inv = await serviceInvoice(ptWholesalerId);
    await run();
    let d = await docOf(inv.id);
    expect(d).toMatchObject({ kind: "SERVICE_INVOICE", format: "PEPPOL_BIS3", status: "INVALID" });
    expect(JSON.stringify(d.validation)).toContain("PEPPOL-EN16931-R020");
    const fin = await ctxFor(SA);
    await E.saveEntityEInvoice(fin, ptEntityId, { language: null, secondLanguage: null, requireOwnLanguage: true, peppolId: "9946:PT517000008" });
    expect((await E.checkDocument(fin, d.id)).findings.filter((f) => f.severity === "error")).toHaveLength(0);
    expect(await E.resendDocument(fin, d.id)).toBe("SENT");
    await run();
    d = await docOf(inv.id);
    expect(d.status).toBe("DELIVERED");
    const xml = (await readStored(d.xmlKey!)).toString("utf8");
    expect(xml).toContain('<cbc:EndpointID schemeID="9946">PT500000000</cbc:EndpointID>');
    expect(xml).toContain("Publicidade FIRINGI — carregamento de saldo pré-pago"); // a Portuguese wholesaler: Portuguese
  });

  it("an outage is retried with back-off; an unregistered recipient fails and alerts finance; a rejection is recorded", async () => {
    await profile(KH, { peppolId: "9946:NETFAIL01" });
    const kh = await ctxFor(KH);
    const a = await serviceInvoice(kh.company.id);
    await run();
    let d = await docOf(a.id);
    expect(d).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(d.nextAt!.getTime()).toBeGreaterThan(Date.now());
    expect(d.lastError).toMatch(/outage/);

    await profile(KH, { peppolId: "9946:NOTREG01" });
    const b = await serviceInvoice(kh.company.id);
    await run();
    d = await docOf(b.id);
    expect(d.status).toBe("FAILED");

    await profile(KH, { peppolId: "9946:REJECT01" });
    const c = await serviceInvoice(kh.company.id);
    await run(); // sent
    await run(); // follow-up → rejected
    d = await docOf(c.id);
    expect(d.status).toBe("REJECTED");
    expect(d.responseNote).toMatch(/rejected/i);
  });

  it("a Factur-X route by e-mail embeds the XML in the PDF", async () => {
    await settings({ countries: route("PT", { format: "FACTURX", provider: "email" }) });
    await profile(KH, { peppolId: null, delivery: "EINVOICE", invoiceEmail: "ap@kebabhouse.test" });
    const kh = await ctxFor(KH);
    const inv = await serviceInvoice(kh.company.id);
    await run();
    const d = await docOf(inv.id);
    expect(d).toMatchObject({ format: "FACTURX", provider: "email", status: "DELIVERED" });
    const pdf = await readStored(d.pdfKey!);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.toString("latin1")).toContain("factur-x.xml");
  });

  it("a format bound to another country's tax system falls back to Peppol for a customer with a Peppol id", async () => {
    await settings({ countries: route("PT", { format: "KSEF_FA3", provider: "ksef", mandatory: true }) });
    const kh = await ctxFor(KH);
    await profile(KH, { peppolId: "9946:PT123456789" });
    const p = await E.planFor(prisma, { kind: "INVOICE", recipientCompanyId: kh.company.id, issuerCountry: "PT" });
    expect(p).toMatchObject({ format: "PEPPOL_BIS3", mandatory: false });
    await profile(KH, { peppolId: null });
    expect(await E.planFor(prisma, { kind: "INVOICE", recipientCompanyId: kh.company.id, issuerCountry: "PT" })).toBeNull();
  });
});

describe("switches, archive, rights", () => {
  it("the XML can be left out of the e-mail copy", async () => {
    await settings({ emailXml: false });
    const { invoice } = await deliverPl([["FIR-COLA33", 6]]);
    const d = await settle(() => docOf(invoice.id));
    expect(["SENT", "ACCEPTED"]).toContain(d.status);
    const ev = await prisma.eInvoiceEvent.findMany({ where: { documentId: d.id } });
    expect(ev.some((e) => /Copy e-mailed to .+ \(PDF\)$/.test(e.message.replace(/\.$/, "")))).toBe(true);
    await settings();
  });

  it("master switch, per-document and per-country switches stop queuing", async () => {
    const kk = await ctxFor(KK);
    await settings({ enabled: false });
    expect(await E.planFor(prisma, { kind: "INVOICE", recipientCompanyId: kk.company.id, issuerCountry: "PL" })).toBeNull();
    await settings({ documents: { ...DEFAULT_EINVOICE_SETTINGS.documents, customerInvoices: false } });
    expect(await E.planFor(prisma, { kind: "INVOICE", recipientCompanyId: kk.company.id, issuerCountry: "PL" })).toBeNull();
    expect(await E.planFor(prisma, { kind: "CREDIT_NOTE", recipientCompanyId: kk.company.id, issuerCountry: "PL" })).not.toBeNull();
    await settings({ countries: route("PL", { enabled: false }) });
    expect(await E.planFor(prisma, { kind: "INVOICE", recipientCompanyId: kk.company.id, issuerCountry: "PL" })).toBeNull();
    await settings();
  });

  it("the archive is intact and the auditor export holds every file with its hash", async () => {
    const sa = await ctxFor(SA);
    const v = await E.verifyArchive(sa);
    expect(v.checked).toBeGreaterThan(3);
    expect(v.broken).toHaveLength(0);
    const from = new Date(Date.now() - 3600_000), to = new Date(Date.now() + 60_000);
    const { zip, count } = await E.auditExport(sa, { from, to });
    expect(count).toBeGreaterThan(3);
    const files = unzipSync(new Uint8Array(zip));
    const manifest = strFromU8(files["manifest.csv"]);
    expect(manifest.split("\n").length).toBeGreaterThan(count);
    expect(manifest).toContain("KSEF_FA3");
    expect(Object.keys(files).some((k) => k.startsWith("outbound/PL/") && k.endsWith(".xml"))).toBe(true);
    expect(Object.keys(files).some((k) => k.startsWith("inbound/PL/"))).toBe(true);
    const docs = await prisma.eInvoiceDocument.findMany({ where: { countryCode: "PL", direction: "OUTBOUND" }, take: 1 });
    expect(docs[0].archiveUntil!.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 5);
  });

  it("only FIRINGI finance sees the queue and settings; companies edit only their own profile; bad ids are refused", async () => {
    await expect(E.einvoiceOverview(await ctxFor(KK))).rejects.toThrow();
    await expect(E.saveEInvoiceSettings(await ctxFor(KK), DEFAULT_EINVOICE_SETTINGS)).rejects.toThrow();
    const kk = await ctxFor(KK);
    const hk = await ctxFor(HK);
    await expect(E.saveProfile(kk, { delivery: "BOTH", peppolId: null, invoiceLanguage: null, secondLanguage: null, ksefNip: null, sdiCode: null, pecEmail: null, leitwegId: null, invoiceEmail: null }, hk.company.id)).rejects.toThrow();
    await expect(E.saveProfile(kk, { delivery: "BOTH", peppolId: "not-an-id", invoiceLanguage: null, secondLanguage: null, ksefNip: null, sdiCode: null, pecEmail: null, leitwegId: null, invoiceEmail: null })).rejects.toThrow(/Peppol/);
    await expect(E.saveProfile(kk, { delivery: "BOTH", peppolId: null, invoiceLanguage: null, secondLanguage: null, ksefNip: "123", sdiCode: null, pecEmail: null, leitwegId: null, invoiceEmail: null })).rejects.toThrow(/NIP/);
    // a customer can't turn on self-billing for itself
    const saved = await E.saveProfile(kk, { delivery: "BOTH", peppolId: null, invoiceLanguage: "en", secondLanguage: null, ksefNip: null, sdiCode: null, pecEmail: null, leitwegId: null, invoiceEmail: null, selfBilling: true });
    expect(saved.selfBilling).toBe(false);
    const ov = await E.einvoiceOverview(await ctxFor(SA));
    expect(ov.providers.find((p) => p.key === "ksef")?.mode).toBe("simulated");
    expect(ov.byStatus.length).toBeGreaterThan(0);
  });
});

describe("monthly pack for the accountant", () => {
  const period = new Date().toISOString().slice(0, 7);
  const nextMonth = (day: number) => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, day, 6)); };

  it("holds the month's documents as XML with a PDF of the totals, in the company's language", async () => {
    const kk = await ctxFor(KK);
    await deliverPl([["FIR-COLA33", 6]]);
    const p = await M.buildMonthlyPack(kk.company.id, period);
    expect(p.rows.length).toBeGreaterThan(0);
    expect(p.language).toBe("pl");
    expect(strFromU8(unzipSync(new Uint8Array(p.zip))["README.txt"])).toContain("Kebab");
    expect(p.summary!.subarray(0, 4).toString()).toBe("%PDF");
    const files = unzipSync(new Uint8Array(p.zip));
    const xml = Object.keys(files).filter((k) => k.startsWith("xml/"));
    expect(xml.length).toBe(p.rows.length);
    expect(strFromU8(files[xml[0]])).toMatch(/<\?xml|<Faktura|<Invoice/);
    expect(files[`summary-${period}.pdf`]).toBeDefined();
    expect(Object.keys(files).some((k) => k.startsWith("pdf/"))).toBe(false);
    await expect(M.buildMonthlyPack(kk.company.id, "2026-13")).rejects.toThrow(/month/);
  });

  it("FIRINGI's options decide what goes in: invoice PDFs on, XML off", async () => {
    const kk = await ctxFor(KK);
    await settings({ monthlyPack: { ...DEFAULT_EINVOICE_SETTINGS.monthlyPack, includeXml: false, includeInvoicePdfs: true } });
    const files = unzipSync(new Uint8Array((await M.buildMonthlyPack(kk.company.id, period)).zip));
    expect(Object.keys(files).some((k) => k.startsWith("xml/"))).toBe(false);
    const pdfs = Object.keys(files).filter((k) => k.startsWith("pdf/"));
    expect(pdfs.length).toBeGreaterThan(0);
    expect(strFromU8(files[pdfs[0]].subarray(0, 4))).toBe("%PDF");
    await settings();
  });

  it("is sent once a month from FIRINGI's day on, only to companies with an accountant e-mail", async () => {
    const kk = await ctxFor(KK);
    await settings({ monthlyPack: { ...DEFAULT_EINVOICE_SETTINGS.monthlyPack, day: 5 } });
    await M.runMonthlyPacks(nextMonth(6), true); // other companies of earlier runs are done; none of ours has an e-mail yet
    expect(await prisma.eInvoiceMonthlyPack.findFirst({ where: { companyId: kk.company.id, period } })).toBeNull();
    await expect(M.sendPackNow(kk, period)).rejects.toThrow(/accountant/);
    await profile(KK, { accountantEmail: "biuro@ksiegowa-test.pl" });
    expect((await M.runMonthlyPacks(nextMonth(3))).skipped).toBe("waits for day 5");
    const r = await M.runMonthlyPacks(nextMonth(5));
    expect(r).toMatchObject({ period, failed: 0 });
    const pack = await prisma.eInvoiceMonthlyPack.findUniqueOrThrow({ where: { companyId_period: { companyId: kk.company.id, period } } });
    expect(pack).toMatchObject({ status: "SENT", sentTo: "biuro@ksiegowa-test.pl" });
    expect(pack.documentCount).toBeGreaterThan(0);
    // the next run of the cron doesn't send it again
    const again = await M.runMonthlyPacks(nextMonth(9));
    expect(again.sent).toBe(0);
    expect((await prisma.eInvoiceMonthlyPack.findUniqueOrThrow({ where: { id: pack.id } })).sentAt).toEqual(pack.sentAt);
    // the mail: summary PDF + ZIP, in Polish
    const outbox = path.resolve(process.env.STORAGE_DIR ?? "./storage", "mail-outbox");
    const mails = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort().slice(-20);
    const mail = (await Promise.all(mails.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8"))))).reverse().find((m) => m.to === "biuro@ksiegowa-test.pl");
    expect(mail.attachments.map((a: { filename: string }) => a.filename)).toEqual(expect.arrayContaining([`FIRINGI-${period}-summary.pdf`, expect.stringMatching(/\.zip$/)]));
    expect(mail.subject).toContain(period);
    await settings();
  });

  it("is off when FIRINGI turns it off; an empty month is recorded without a mail; the company can send a month by hand", async () => {
    const kk = await ctxFor(KK);
    await settings({ monthlyPack: { ...DEFAULT_EINVOICE_SETTINGS.monthlyPack, enabled: false } });
    expect((await M.runMonthlyPacks(nextMonth(20))).skipped).toBe("off");
    await settings();
    const empty = await M.sendPackNow(kk, "2019-01");
    expect(empty).toMatchObject({ status: "EMPTY", documentCount: 0 });
    const again = await M.sendPackNow(kk, period);
    expect(again.status).toBe("SENT");
    const mine = await M.myPacks(kk);
    expect(mine.map((p) => p.period)).toEqual(expect.arrayContaining([period, "2019-01"]));
    const forced = await M.runPacksNow(await ctxFor(SA));
    expect(forced.failed).toBe(0);
    const recent = await M.recentPacks(await ctxFor(SA));
    expect(recent.withAccountant).toBeGreaterThan(0);
    expect(recent.packs.some((p) => p.companyId === kk.company.id)).toBe(true);
  });

  it("only the company itself and FIRINGI finance get a company's pack", async () => {
    const kk = await ctxFor(KK), hk = await ctxFor(HK);
    await expect(M.downloadPack(hk, period, kk.company.id)).rejects.toThrow();
    await expect(M.myPacks(hk, kk.company.id)).rejects.toThrow();
    await expect(M.sendPackNow(hk, period, kk.company.id)).rejects.toThrow();
    await expect(M.recentPacks(kk)).rejects.toThrow();
    await expect(M.runPacksNow(kk)).rejects.toThrow();
    expect((await M.downloadPack(await ctxFor(SA), period, kk.company.id)).rows.length).toBeGreaterThan(0);
    await expect(profile(KK, { accountantEmail: "not-an-email" })).rejects.toThrow();
  });
});
