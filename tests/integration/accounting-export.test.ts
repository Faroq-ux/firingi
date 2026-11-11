/**
 * Phase 21: accounting exports.
 *  • FIRINGI: every journal balances (debits = credits) over the demo data; documents / entries /
 *    PHC / Primavera / Sage layouts; CSV (";", decimal comma, BOM) and Excel; the account mapping
 *    is validated and used (per-partner sub-accounts); only finance staff may export.
 *  • Companies: buyers export their invoices and payments, suppliers their statements, invoices
 *    and payouts — only their own, and a buyer's file never mentions commission.
 */
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import {
  DEFAULT_ACCOUNTS, JOURNALS, accountMap, accountingPreview, companyExportsFor, exportAccounting, exportCompany, saveAccountMap, toCsv, toEntries, type Doc,
} from "@/server/integrations/accounting";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { issueCreditNote, recordPayment } from "@/server/services/finance";
import { setStock } from "@/server/services/vendor-catalogue";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", FIN = "finance@firingi.test", SALES = "sales@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test";
const TO = new Date().toISOString().slice(0, 10), FROM = new Date(Date.now() - 364 * 86400_000).toISOString().slice(0, 10);
let saved: Awaited<ReturnType<typeof accountMap>>;

/** The test database starts without documents: make one of each the real way. */
async function makeDocuments() {
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX), sa = await ctxFor(SA);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE" } });
  await setStock(lx, offer.id, wh.id, 900);
  await clearCart(kebab);
  await addToCart(kebab, offer.id, 25);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
  await confirmOrder(lx, id, {});
  for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (o.status !== "DELIVERED") await changeOrderStatus(lx, id, st).catch(async () => changeOrderStatus(sa, id, st));
  }
  const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] } }, include: { lines: true } });
  await issueCreditNote(sa, inv.id, { lines: [{ invoiceLineId: inv.lines[0].id, qty: 1 }], reason: "one damaged" });
  await recordPayment(sa, { direction: "INBOUND", companyId: kebab.company.id, method: "BANK_TRANSFER", amount: 5, reference: "TRF-ACC-1", paidAt: new Date(), allocations: [{ documentId: inv.id, amount: 5 }] });
  const vi = await prisma.vendorInvoice.create({ data: { vendorCompanyId: lx.company.id, externalNumber: `FT LX/${Date.now()}`, issueDate: new Date(), netTotal: 10, vatTotal: 2.3, grossTotal: 12.3, fileKey: "test/none.pdf", status: "APPROVED" } });
  await recordPayment(sa, { direction: "OUTBOUND", companyId: lx.company.id, method: "BANK_TRANSFER", amount: 12.3, reference: "TRF-ACC-2", paidAt: new Date(), allocations: [{ documentId: vi.id, amount: 12.3 }] });
}
beforeAll(async () => { saved = await accountMap(); await makeDocuments(); });
afterAll(async () => { await saveAccountMap(await ctxFor(SA), saved); });

const readXlsx = async (b: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b as unknown as ArrayBuffer); return wb; };

describe("FIRINGI's export", () => {
  it("balances: debits equal credits for every journal", async () => {
    const fin = await ctxFor(FIN);
    const p = await accountingPreview(fin, { from: FROM, to: TO, journals: [] });
    expect(p.documents).toBeGreaterThan(0);
    expect(p.debit).toBe(p.credit);
    expect(p.balanced).toBe(true);
    for (const j of JOURNALS) {
      const one = await accountingPreview(fin, { from: FROM, to: TO, journals: [j] });
      expect(one.balanced, j).toBe(true);
    }
    expect(p.byJournal.find((j) => j.journal === "SALES")!.count).toBeGreaterThan(0);
  });

  it("books a sale, a credit note, a receipt, a supplier invoice with reverse charge and a payout", () => {
    const D = (n: number) => new Decimal(n);
    const base = { date: new Date("2026-05-02"), partner: "Kebab House", taxId: "500000001", country: "PT", dueDate: null, reference: "", status: "ISSUED" };
    const docs: Doc[] = [
      { ...base, journal: "SALES", number: "FT 1", kind: "INVOICE", net: D(100), vat: D(17.5), gross: D(117.5), byRate: [{ rate: "23", base: D(50), vat: D(11.5) }, { rate: "13", base: D(50), vat: D(6.5) }].map((r) => ({ ...r, vat: r.rate === "13" ? D(6) : r.vat })) },
      { ...base, journal: "CREDIT_NOTES", number: "NC 1", kind: "CREDIT_NOTE", net: D(10), vat: D(2.3), gross: D(12.3), byRate: [{ rate: "23", base: D(10), vat: D(2.3) }] },
      { ...base, journal: "RECEIPTS", number: "PAY-1", kind: "RECEIPT", net: D(105.2), vat: D(0), gross: D(105.2), byRate: [], method: "MB_WAY" },
      { ...base, journal: "SUPPLIER_INVOICES", number: "F/7", kind: "INVOICE", partner: "Atlantico", net: D(80), vat: D(0), gross: D(80), byRate: [{ rate: "0", base: D(80), vat: D(0) }], selfAssessedVat: D(18.4) },
      { ...base, journal: "PAYOUTS", number: "TRF-9", kind: "PAYOUT", partner: "Atlantico", net: D(80), vat: D(0), gross: D(80), byRate: [], method: "BANK_TRANSFER" },
    ];
    const e = toEntries(docs, { ...DEFAULT_ACCOUNTS, perPartner: true });
    const sum = (k: "debit" | "credit", f = (_: (typeof e)[number]) => true) => e.filter(f).reduce((a, x) => a.plus(x[k]), D(0)).toNumber();
    expect(sum("debit")).toBe(sum("credit"));
    expect(e.filter((x) => x.document === "FT 1").map((x) => `${x.account} ${x.debit} ${x.credit}`)).toEqual(["211500000001 117.5 0", "711 0 50", "243311 0 11.5", "711 0 50", "243312 0 6"]);
    expect(e.find((x) => x.document === "NC 1" && x.account === "711")).toMatchObject({ debit: D(10) });
    expect(e.find((x) => x.document === "PAY-1" && x.debit.gt(0))!.account).toBe("278"); // MB WAY → clearing account
    expect(e.filter((x) => x.document === "F/7" && x.description.includes("reverse")).map((x) => x.account)).toEqual(["243211", "243311"]);
    expect(e.find((x) => x.document === "TRF-9" && x.credit.gt(0))!.account).toBe("12");
    for (const d of docs) expect(sum("debit", (x) => x.document === d.number), d.number).toBe(sum("credit", (x) => x.document === d.number));
  });

  it("writes CSV and Excel in each layout", async () => {
    const fin = await ctxFor(FIN);
    const docs = await exportAccounting(fin, { from: FROM, to: TO, journals: ["SALES"], format: "documents", file: "csv" });
    const text = String(docs.body);
    expect(text.startsWith("﻿Journal;Date;Document;Type;Partner;Tax ID")).toBe(true);
    expect(text.split("\r\n")[1]).toMatch(/;\d+,\d{2};/); // decimal comma
    expect(docs.fileName).toBe(`firingi-documents-${FROM}_${TO}.csv`);

    const heads = { phc: "Diario;Data;Documento;Conta;Descricao;Debito;Credito;NIF", primavera: "Diario;Data;Documento;Conta;Natureza;Valor;Descricao;Contribuinte", sage: "Diario;Data;NDocumento;Conta;Descritivo;ValorDebito;ValorCredito;NContribuinte" } as const;
    for (const [f, h] of Object.entries(heads)) {
      const out = await exportAccounting(fin, { from: FROM, to: TO, journals: [], format: f as "phc", file: "csv" });
      expect(String(out.body).slice(1).split("\r\n")[0], f).toBe(h);
    }
    const x = await exportAccounting(fin, { from: FROM, to: TO, journals: [], format: "entries", file: "xlsx" });
    const wb = await readXlsx(x.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Entries", "Documents"]);
    const ws = wb.worksheets[0];
    let dr = 0, cr = 0;
    ws.eachRow((r, i) => { if (i > 1) { dr += Number(r.getCell(6).value); cr += Number(r.getCell(7).value); } });
    expect(Math.abs(dr - cr)).toBeLessThan(0.01);
    expect(await prisma.auditLog.count({ where: { action: "accounting.exported", actorUserId: fin.user.id } })).toBeGreaterThan(0);
  });

  it("uses the saved mapping; validates it; staff only", async () => {
    const sa = await ctxFor(SA);
    await expect(saveAccountMap(sa, { ...saved, customers: "21a" })).rejects.toThrow(/digits/);
    await saveAccountMap(sa, { ...saved, sales: "7111", decimal: "dot" });
    const out = await exportAccounting(await ctxFor(FIN), { from: FROM, to: TO, journals: ["SALES"], format: "entries", file: "csv" });
    expect(String(out.body)).toContain(";7111;");
    await expect(exportAccounting(await ctxFor(KEBAB), { from: FROM, to: TO, journals: [], format: "documents", file: "csv" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveAccountMap(await ctxFor(SALES), saved)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportAccounting(await ctxFor(FIN), { from: TO, to: FROM, journals: [], format: "documents", file: "csv" })).rejects.toThrow(/before/);
  });

  it("CSV quoting", () => {
    expect(toCsv({ name: "x", headers: ["a", "b"], rows: [['say "hi"; ok', 1.5]], money: [1] }, "comma")).toBe('﻿a;b\r\n"say ""hi""; ok";1,50\r\n');
  });
});

describe("companies' exports", () => {
  it("buyers get their invoices and payments, never commission", async () => {
    const kebab = await ctxFor(KEBAB);
    expect(companyExportsFor(kebab)).toEqual(["buyer.invoices", "buyer.payments"]);
    const out = await exportCompany(kebab, { from: FROM, to: TO, kinds: ["buyer.invoices", "supplier.statements" /* not theirs */], file: "csv" });
    const text = String(out.body);
    expect(text).not.toMatch(/commission/i);
    const lines = text.trim().split("\r\n").slice(1);
    expect(lines.length).toBeGreaterThan(0);
    const mine = await prisma.invoice.count({ where: { recipientCompanyId: kebab.company.id, status: { not: "DRAFT" }, issuedAt: { gte: new Date(FROM) } } });
    expect(lines.length).toBe(mine);
  });

  it("suppliers get statements, invoices and payouts in one workbook", async () => {
    const lx = await ctxFor(LX); // a wholesaler: both sides
    expect(companyExportsFor(lx)).toEqual(expect.arrayContaining(["buyer.invoices", "supplier.statements", "supplier.payouts"]));
    const out = await exportCompany(lx, { from: FROM, to: TO, kinds: ["supplier.statements", "supplier.invoices", "supplier.payouts"], file: "csv" });
    expect(out.fileName.endsWith(".xlsx")).toBe(true); // several tables → one workbook
    const wb = await readXlsx(out.body as Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Billing statements", "Invoices you sent to FIRINGI", "Payouts received"]);
    const statements = await prisma.vendorBillingStatement.count({ where: { vendorCompanyId: lx.company.id, createdAt: { gte: new Date(FROM) } } });
    expect(wb.worksheets[0].rowCount - 1).toBe(statements);
    await expect(exportCompany(await ctxFor(FIN), { from: FROM, to: TO, kinds: ["buyer.invoices"], file: "csv" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
