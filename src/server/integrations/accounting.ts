/**
 * Accounting exports — FIRINGI's books for its accountant, and each company's own documents.
 *
 * FIRINGI (admin › Finance › Accounting export), for a date range:
 *   journals  SALES (invoices) · CREDIT_NOTES · RECEIPTS (money in) · SUPPLIER_INVOICES · PAYOUTS (money out)
 *   formats   "documents"  one row per document — the easiest to read and check (CSV or Excel);
 *             "entries"    double-entry lines (account, debit, credit) with FIRINGI's chart of accounts;
 *             "phc" / "primavera" / "sage"  the same entries laid out with the column names those
 *             programs' journal-entry imports use. Import templates differ between versions and
 *             set-ups: the accountant confirms the layout (and the account mapping) before the
 *             first import. The legal tax file for Portugal is still the SAF-T (Invoices › SAF-T).
 *   accounts  SNC defaults (211 customers, 221 suppliers, 711 sales, 312 purchases, 2433 / 2432 VAT,
 *             12 bank, 11 cash), changeable in Settings; per-customer / per-supplier sub-accounts optional.
 *
 * Companies (portal › Exports): suppliers get their statements, invoices sent to FIRINGI and payouts;
 * buyers get FIRINGI's invoices to them and their payments. Never anything about another company,
 * and buyers never see commission.
 */
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

export const JOURNALS = ["SALES", "CREDIT_NOTES", "RECEIPTS", "SUPPLIER_INVOICES", "PAYOUTS"] as const;
export type Journal = (typeof JOURNALS)[number];
export const FORMATS = ["documents", "entries", "phc", "primavera", "sage"] as const;
export type Format = (typeof FORMATS)[number];
export type FileType = "csv" | "xlsx";

export const JOURNAL_LABEL: Record<Journal, string> = {
  SALES: "Sales invoices", CREDIT_NOTES: "Credit notes", RECEIPTS: "Receipts (money in)", SUPPLIER_INVOICES: "Supplier invoices", PAYOUTS: "Supplier payouts (money out)",
};
export const FORMAT_LABEL: Record<Format, string> = {
  documents: "Documents — one row per document (easiest to read)", entries: "Journal entries — debit / credit per account",
  phc: "PHC — journal entries layout", primavera: "Primavera — journal entries layout", sage: "Sage — journal entries layout",
};

// ── account mapping ─────────────────────────────────────────────────────────

export type AccountMap = {
  customers: string; suppliers: string; sales: string; purchases: string; bank: string; cash: string; cardClearing: string;
  vatOutput: Record<string, string>; vatInput: Record<string, string>; perPartner: boolean;
  journals: Record<Journal, string>; decimal: "comma" | "dot";
};
export const DEFAULT_ACCOUNTS: AccountMap = {
  customers: "211", suppliers: "221", sales: "711", purchases: "312", bank: "12", cash: "11", cardClearing: "278",
  vatOutput: { "23": "243311", "13": "243312", "6": "243313", "0": "2433", other: "2433" },
  vatInput: { "23": "243211", "13": "243212", "6": "243213", "0": "2432", other: "2432" },
  perPartner: false,
  journals: { SALES: "2", CREDIT_NOTES: "2", RECEIPTS: "3", SUPPLIER_INVOICES: "1", PAYOUTS: "3" },
  decimal: "comma",
};
const KEY = "accounting.export";

function requireStaff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.finance.manage" : ["admin.finance.view", "admin.invoices.view"])) throw new ForbiddenError();
}

export async function accountMap(): Promise<AccountMap> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  const v = (s?.value ?? {}) as Partial<AccountMap>;
  return { ...DEFAULT_ACCOUNTS, ...v, vatOutput: { ...DEFAULT_ACCOUNTS.vatOutput, ...v.vatOutput }, vatInput: { ...DEFAULT_ACCOUNTS.vatInput, ...v.vatInput }, journals: { ...DEFAULT_ACCOUNTS.journals, ...v.journals } };
}

const ACCOUNT = /^\d{1,12}$/;
export async function saveAccountMap(ctx: Ctx, input: AccountMap) {
  requireStaff(ctx, true);
  const accounts = ["customers", "suppliers", "sales", "purchases", "bank", "cash", "cardClearing"] as const;
  for (const a of accounts) if (!ACCOUNT.test(String(input[a] ?? ""))) throw new ValidationError(`Account for ${a} should be digits only.`);
  for (const [r, a] of [...Object.entries(input.vatOutput ?? {}), ...Object.entries(input.vatInput ?? {})]) if (!ACCOUNT.test(a)) throw new ValidationError(`VAT account for ${r} % should be digits only.`);
  for (const j of JOURNALS) if (!/^[\w-]{1,10}$/.test(input.journals?.[j] ?? "")) throw new ValidationError(`Journal code for ${JOURNAL_LABEL[j]} is missing.`);
  const value: AccountMap = { ...DEFAULT_ACCOUNTS, ...input, perPartner: !!input.perPartner, decimal: input.decimal === "dot" ? "dot" : "comma" };
  const before = await accountMap();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    create: { scope: "GLOBAL", scopeId: "", key: KEY, value: value as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    update: { value: value as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "accounting.mapping_saved", entityType: "Setting", entityId: KEY, before, after: value });
  return value;
}

// ── collecting documents ──────────────────────────────────────────────────

export type Doc = {
  journal: Journal; date: Date; number: string; kind: string; partner: string; taxId: string; country: string;
  net: Decimal; vat: Decimal; gross: Decimal; byRate: { rate: string; base: Decimal; vat: Decimal }[]; selfAssessedVat?: Decimal;
  dueDate: Date | null; reference: string; method?: string; status: string;
};

const D = (v: { toString(): string } | number | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const rateKey = (r: { toString(): string }) => new Decimal(r.toString()).toDecimalPlaces(2).toString();

export function range(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00.000Z`), to = new Date(`${toIso}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ValidationError("Choose a start and an end date.");
  if (to < from) throw new ValidationError("The end date is before the start date.");
  if (to.getTime() - from.getTime() > 400 * 86400_000) throw new ValidationError("At most about a year per export.");
  return { from, toExclusive: new Date(to.getTime() + 86400_000) };
}

async function collect(journals: Journal[], from: Date, toExclusive: Date, only?: { recipientCompanyId?: string; vendorCompanyId?: string }): Promise<Doc[]> {
  const docs: Doc[] = [];
  const want = new Set(journals);
  if (want.has("SALES") || want.has("CREDIT_NOTES")) {
    const types = [...(want.has("SALES") ? (["INVOICE", "INVOICE_RECEIPT"] as const) : []), ...(want.has("CREDIT_NOTES") ? (["CREDIT_NOTE"] as const) : [])];
    const rows = await prisma.invoice.findMany({
      where: { status: { not: "DRAFT" }, docType: { in: [...types] }, issuedAt: { gte: from, lt: toExclusive }, ...(only?.recipientCompanyId ? { recipientCompanyId: only.recipientCompanyId } : {}) },
      include: { taxSummary: true, order: { select: { number: true } }, originalInvoice: { select: { fullNumber: true, providerNumber: true } } },
      orderBy: [{ issuedAt: "asc" }, { number: "asc" }],
    });
    for (const r of rows) {
      const snap = (r.recipientSnapshot ?? {}) as { name?: string; taxId?: string; country?: string };
      docs.push({
        journal: r.docType === "CREDIT_NOTE" ? "CREDIT_NOTES" : "SALES", date: r.issuedAt!, number: r.providerNumber ?? r.fullNumber ?? r.id, kind: r.docType,
        partner: snap.name ?? "", taxId: snap.taxId ?? "", country: snap.country ?? "", net: D(r.netTotal), vat: D(r.vatTotal), gross: D(r.grossTotal),
        byRate: r.taxSummary.length ? r.taxSummary.map((t) => ({ rate: rateKey(t.taxRate), base: D(t.base), vat: D(t.vat) })) : [{ rate: "other", base: D(r.netTotal), vat: D(r.vatTotal) }],
        dueDate: r.dueAt, reference: r.docType === "CREDIT_NOTE" ? (r.originalInvoice?.providerNumber ?? r.originalInvoice?.fullNumber ?? "") : (r.order?.number ?? ""), status: r.status,
      });
    }
  }
  if (want.has("SUPPLIER_INVOICES")) {
    const rows = await prisma.vendorInvoice.findMany({
      where: { status: { in: ["APPROVED", "PAID"] }, issueDate: { gte: from, lt: toExclusive }, ...(only?.vendorCompanyId ? { vendorCompanyId: only.vendorCompanyId } : {}) },
      include: { vendor: { select: { legalName: true, taxId: true, country: { select: { code: true } } } } },
      orderBy: { issueDate: "asc" },
    });
    for (const r of rows)
      docs.push({
        journal: "SUPPLIER_INVOICES", date: r.issueDate, number: r.externalNumber, kind: r.docType, partner: r.vendor.legalName, taxId: r.vendor.taxId, country: r.vendor.country.code,
        net: D(r.netTotal), vat: D(r.vatTotal), gross: D(r.grossTotal), byRate: [{ rate: guessRate(D(r.netTotal), D(r.vatTotal)), base: D(r.netTotal), vat: D(r.vatTotal) }],
        selfAssessedVat: D(r.selfAssessedVat), dueDate: r.dueDate, reference: "", status: r.status,
      });
  }
  if (want.has("RECEIPTS") || want.has("PAYOUTS")) {
    const dirs = [...(want.has("RECEIPTS") ? (["INBOUND"] as const) : []), ...(want.has("PAYOUTS") ? (["OUTBOUND"] as const) : [])];
    const companyId = only?.recipientCompanyId ?? only?.vendorCompanyId;
    const rows = await prisma.payment.findMany({
      where: { status: "CONFIRMED", direction: { in: [...dirs] }, paidAt: { gte: from, lt: toExclusive }, ...(companyId ? { companyId } : {}) },
      include: {
        company: { select: { legalName: true, taxId: true, country: { select: { code: true } } } },
        allocations: { include: { invoice: { select: { fullNumber: true, providerNumber: true } }, vendorInvoice: { select: { externalNumber: true } } } },
      },
      orderBy: { paidAt: "asc" },
    });
    for (const p of rows)
      docs.push({
        journal: p.direction === "INBOUND" ? "RECEIPTS" : "PAYOUTS", date: p.paidAt!, number: p.reference || `PAY-${p.id.slice(-8).toUpperCase()}`, kind: p.direction === "INBOUND" ? "RECEIPT" : "PAYOUT",
        partner: p.company.legalName, taxId: p.company.taxId, country: p.company.country.code, net: D(p.amount), vat: D(0), gross: D(p.amount), byRate: [],
        dueDate: null, reference: p.allocations.map((a) => a.invoice?.providerNumber ?? a.invoice?.fullNumber ?? a.vendorInvoice?.externalNumber).filter(Boolean).join(" "), method: p.method, status: p.status,
      });
  }
  return docs.sort((a, b) => a.date.getTime() - b.date.getTime() || JOURNALS.indexOf(a.journal) - JOURNALS.indexOf(b.journal));
}

/** A supplier invoice carries totals only: the usual Portuguese rate that fits, else "other". */
function guessRate(net: Decimal, vat: Decimal) {
  if (net.isZero()) return "other";
  const r = vat.div(net).times(100);
  return ["23", "13", "6", "0"].find((x) => r.minus(x).abs().lt(0.6)) ?? "other";
}

// ── double entry ───────────────────────────────────────────────────────────

export type Entry = { journal: string; journalKey: Journal; date: Date; document: string; account: string; description: string; debit: Decimal; credit: Decimal; taxId: string; partner: string };

const partnerAccount = (base: string, m: AccountMap, taxId: string) => (m.perPartner && /^\d+$/.test(taxId) ? `${base}${taxId}` : base);
const vatAccount = (map: Record<string, string>, rate: string) => map[rate] ?? map[String(Number(rate))] ?? map.other;
const cashAccount = (m: AccountMap, method?: string) => (method === "CASH" ? m.cash : method === "CARD" || method === "MB_WAY" || method === "MULTIBANCO" ? m.cardClearing : m.bank);

export function toEntries(docs: Doc[], m: AccountMap): Entry[] {
  const out: Entry[] = [];
  const zero = new Decimal(0);
  for (const d of docs) {
    const add = (account: string, debit: Decimal, credit: Decimal, what: string) => {
      if (debit.isZero() && credit.isZero()) return;
      // A negative amount goes to the other side (credit notes, corrections).
      const [dr, cr] = debit.lt(0) || credit.lt(0) ? [credit.abs(), debit.abs()] : [debit, credit];
      out.push({ journal: m.journals[d.journal], journalKey: d.journal, date: d.date, document: d.number, account, description: `${what} ${d.number} ${d.partner}`.trim().slice(0, 120), debit: dr, credit: cr, taxId: d.taxId, partner: d.partner });
    };
    const customer = partnerAccount(m.customers, m, d.taxId), supplier = partnerAccount(m.suppliers, m, d.taxId);
    switch (d.journal) {
      case "SALES":
        add(customer, d.gross, zero, "Invoice");
        for (const r of d.byRate) { add(m.sales, zero, r.base, "Sales"); add(vatAccount(m.vatOutput, r.rate), zero, r.vat, `VAT ${r.rate}%`); }
        break;
      case "CREDIT_NOTES":
        add(customer, zero, d.gross, "Credit note");
        for (const r of d.byRate) { add(m.sales, r.base, zero, "Sales returned"); add(vatAccount(m.vatOutput, r.rate), r.vat, zero, `VAT ${r.rate}%`); }
        break;
      case "RECEIPTS":
        add(cashAccount(m, d.method), d.gross, zero, "Received");
        add(customer, zero, d.gross, "Received");
        break;
      case "SUPPLIER_INVOICES": {
        const credit = d.kind === "CREDIT_NOTE";
        for (const r of d.byRate) {
          add(m.purchases, credit ? zero : r.base, credit ? r.base : zero, "Purchases");
          add(vatAccount(m.vatInput, r.rate), credit ? zero : r.vat, credit ? r.vat : zero, `VAT ${r.rate}%`);
        }
        add(supplier, credit ? d.gross : zero, credit ? zero : d.gross, credit ? "Supplier credit note" : "Supplier invoice");
        if (d.selfAssessedVat?.gt(0)) { // intra-EU reverse charge: deductible and payable
          add(vatAccount(m.vatInput, "23"), d.selfAssessedVat, zero, "VAT reverse charge");
          add(vatAccount(m.vatOutput, "23"), zero, d.selfAssessedVat, "VAT reverse charge");
        }
        break;
      }
      case "PAYOUTS":
        add(supplier, d.gross, zero, "Paid");
        add(cashAccount(m, d.method), zero, d.gross, "Paid");
        break;
    }
  }
  return out;
}

// ── files ──────────────────────────────────────────────────────────────────

type Table = { name: string; headers: string[]; rows: (string | number | Date | null)[][]; money?: number[] };

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
const n2 = (v: Decimal) => Number(v.toFixed(2));

export function documentsTable(docs: Doc[]): Table {
  return {
    name: "Documents",
    headers: ["Journal", "Date", "Document", "Type", "Partner", "Tax ID", "Country", "Net", "VAT", "Gross", "VAT detail", "Due date", "Reference", "Method", "Status"],
    rows: docs.map((d) => [
      JOURNAL_LABEL[d.journal], ymd(d.date), d.number, d.kind, d.partner, d.taxId, d.country, n2(d.net), n2(d.vat), n2(d.gross),
      d.byRate.map((r) => `${r.rate}%: ${r.base.toFixed(2)} + ${r.vat.toFixed(2)}`).join(" | "), ymd(d.dueDate), d.reference, d.method ?? "", d.status,
    ]),
    money: [7, 8, 9],
  };
}

export function entriesTable(entries: Entry[], format: Exclude<Format, "documents">): Table {
  switch (format) {
    case "phc":
      return { name: "Lancamentos", headers: ["Diario", "Data", "Documento", "Conta", "Descricao", "Debito", "Credito", "NIF"], rows: entries.map((e) => [e.journal, dmy(e.date), e.document, e.account, e.description, n2(e.debit), n2(e.credit), e.taxId]), money: [5, 6] };
    case "primavera":
      return { name: "Movimentos", headers: ["Diario", "Data", "Documento", "Conta", "Natureza", "Valor", "Descricao", "Contribuinte"], rows: entries.map((e) => [e.journal, ymd(e.date), e.document, e.account, e.debit.gt(0) ? "D" : "C", n2(e.debit.gt(0) ? e.debit : e.credit), e.description, e.taxId]), money: [5] };
    case "sage":
      return { name: "Lancamentos", headers: ["Diario", "Data", "NDocumento", "Conta", "Descritivo", "ValorDebito", "ValorCredito", "NContribuinte"], rows: entries.map((e) => [e.journal, dmy(e.date), e.document, e.account, e.description, n2(e.debit), n2(e.credit), e.taxId]), money: [5, 6] };
    default:
      return { name: "Entries", headers: ["Journal", "Date", "Document", "Account", "Description", "Debit", "Credit", "Tax ID", "Partner"], rows: entries.map((e) => [e.journal, ymd(e.date), e.document, e.account, e.description, n2(e.debit), n2(e.credit), e.taxId, e.partner]), money: [5, 6] };
  }
}

/** CSV with ";" (opens directly in European Excel), BOM, decimal comma or dot. */
export function toCsv(t: Table, decimal: "comma" | "dot" = "comma") {
  const cell = (v: string | number | Date | null, i: number) => {
    let s = v == null ? "" : v instanceof Date ? ymd(v) : typeof v === "number" ? v.toFixed(t.money?.includes(i) ? 2 : 0) : String(v);
    if (typeof v === "number" && decimal === "comma") s = s.replace(".", ",");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[t.headers.join(";"), ...t.rows.map((r) => r.map(cell).join(";"))].join("\r\n")}\r\n`;
}

export async function toXlsx(tables: Table[], title: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FIRINGI";
  wb.title = title;
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name.slice(0, 31));
    ws.addRow(t.headers).font = { bold: true };
    for (const r of t.rows) ws.addRow(r);
    for (const i of t.money ?? []) ws.getColumn(i + 1).numFmt = "#,##0.00";
    ws.columns.forEach((c, i) => { c.width = Math.min(48, Math.max(10, t.headers[i].length + 2, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 1))); });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.headers.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type ExportFile = { body: Buffer | string; fileName: string; contentType: string; rows: number };
const CT = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

// ── FIRINGI's export ───────────────────────────────────────────────────────

export async function accountingPreview(ctx: Ctx, input: { from: string; to: string; journals: Journal[] }) {
  requireStaff(ctx);
  const { from, toExclusive } = range(input.from, input.to);
  const docs = await collect(input.journals.length ? input.journals : [...JOURNALS], from, toExclusive);
  const entries = toEntries(docs, await accountMap());
  const debit = entries.reduce((a, e) => a.plus(e.debit), new Decimal(0)), credit = entries.reduce((a, e) => a.plus(e.credit), new Decimal(0));
  const byJournal = JOURNALS.map((j) => {
    const ds = docs.filter((d) => d.journal === j);
    return { journal: j, label: JOURNAL_LABEL[j], count: ds.length, net: ds.reduce((a, d) => a.plus(d.net), new Decimal(0)).toFixed(2), vat: ds.reduce((a, d) => a.plus(d.vat), new Decimal(0)).toFixed(2), gross: ds.reduce((a, d) => a.plus(d.gross), new Decimal(0)).toFixed(2) };
  });
  return { byJournal, documents: docs.length, entries: entries.length, debit: debit.toFixed(2), credit: credit.toFixed(2), balanced: debit.minus(credit).abs().lt(0.005), sample: documentsTable(docs.slice(0, 12)) };
}

export async function exportAccounting(ctx: Ctx, input: { from: string; to: string; journals: Journal[]; format: Format; file: FileType }): Promise<ExportFile> {
  requireStaff(ctx);
  if (!FORMATS.includes(input.format)) throw new ValidationError("Unknown format.");
  const { from, toExclusive } = range(input.from, input.to);
  const journals = (input.journals.length ? input.journals : [...JOURNALS]).filter((j) => JOURNALS.includes(j));
  const docs = await collect(journals, from, toExclusive);
  const m = await accountMap();
  const table = input.format === "documents" ? documentsTable(docs) : entriesTable(toEntries(docs, m), input.format);
  const base = `firingi-${input.format}-${input.from}_${input.to}`;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "accounting.exported", entityType: "Export", entityId: base, after: { ...input, documents: docs.length } });
  if (input.file === "xlsx") {
    const tables = input.format === "documents" ? [table] : [table, documentsTable(docs)];
    return { body: await toXlsx(tables, base), fileName: `${base}.xlsx`, contentType: CT.xlsx, rows: table.rows.length };
  }
  return { body: toCsv(table, input.format === "documents" || input.format === "entries" ? m.decimal : "comma"), fileName: `${base}.csv`, contentType: CT.csv, rows: table.rows.length };
}

// ── companies' own exports ─────────────────────────────────────────────────

export const COMPANY_EXPORTS = {
  "buyer.invoices": { for: "BUYER", label: "Invoices and credit notes from FIRINGI" },
  "buyer.payments": { for: "BUYER", label: "Your payments" },
  "supplier.statements": { for: "SUPPLIER", label: "Billing statements (what FIRINGI owes you per order)" },
  "supplier.invoices": { for: "SUPPLIER", label: "Invoices you sent to FIRINGI" },
  "supplier.payouts": { for: "SUPPLIER", label: "Payouts received" },
} as const;
export type CompanyExport = keyof typeof COMPANY_EXPORTS;

export function companyExportsFor(ctx: Ctx): CompanyExport[] {
  const supplier = (ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER") && can(ctx, ["vendor.invoices.view", "vendor.invoices.submit", "vendor.payments.view"]);
  const buyer = (ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER") && can(ctx, ["buyer.invoices.view", "buyer.payments.view"]);
  return (Object.keys(COMPANY_EXPORTS) as CompanyExport[]).filter((k) => (COMPANY_EXPORTS[k].for === "BUYER" ? buyer : supplier));
}

async function companyTable(ctx: Ctx, kind: CompanyExport, from: Date, toExclusive: Date): Promise<Table> {
  const me = ctx.company.id;
  switch (kind) {
    case "buyer.invoices":
      return documentsTable(await collect(["SALES", "CREDIT_NOTES"], from, toExclusive, { recipientCompanyId: me }));
    case "buyer.payments":
      return documentsTable(await collect(["RECEIPTS"], from, toExclusive, { recipientCompanyId: me }));
    case "supplier.invoices":
      return documentsTable(await collect(["SUPPLIER_INVOICES"], from, toExclusive, { vendorCompanyId: me }));
    case "supplier.payouts":
      return documentsTable(await collect(["PAYOUTS"], from, toExclusive, { vendorCompanyId: me }));
    case "supplier.statements": {
      const rows = await prisma.vendorBillingStatement.findMany({ where: { vendorCompanyId: me, createdAt: { gte: from, lt: toExclusive } }, include: { order: { select: { number: true } } }, orderBy: { createdAt: "asc" } });
      return {
        name: "Statements", headers: ["Statement", "Date", "Order", "Credit (return)", "Net", "VAT", "Gross", "Commission", "Status"],
        rows: rows.map((r) => [r.number, ymd(r.createdAt), r.order.number, r.isCreditStatement ? "yes" : "", n2(D(r.expectedNet)), n2(D(r.expectedVat)), n2(D(r.expectedGross)), n2(D(r.commissionTotal)), r.status]),
        money: [4, 5, 6, 7],
      };
    }
  }
}

export async function exportCompany(ctx: Ctx, input: { from: string; to: string; kinds: string[]; file: FileType }): Promise<ExportFile> {
  if (ctx.company.type === "ADMIN" || ctx.company.status !== "APPROVED") throw new ForbiddenError();
  const allowed = companyExportsFor(ctx);
  const kinds = [...new Set(input.kinds)].filter((k): k is CompanyExport => allowed.includes(k as CompanyExport));
  if (!kinds.length) throw new ValidationError("Choose what to export.");
  const { from, toExclusive } = range(input.from, input.to);
  const tables: Table[] = [];
  for (const k of kinds) tables.push({ ...(await companyTable(ctx, k, from, toExclusive)), name: COMPANY_EXPORTS[k].label.split(" (")[0] });
  const base = `firingi-${kinds.length === 1 ? kinds[0].replace(".", "-") : "export"}-${input.from}_${input.to}`;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.exported", entityType: "Export", entityId: base, after: { kinds, from: input.from, to: input.to } });
  if (input.file === "xlsx" || tables.length > 1) return { body: await toXlsx(tables, base), fileName: `${base}.xlsx`, contentType: CT.xlsx, rows: tables.reduce((a, t) => a + t.rows.length, 0) };
  return { body: toCsv(tables[0], "comma"), fileName: `${base}.csv`, contentType: CT.csv, rows: tables[0].rows.length };
}
