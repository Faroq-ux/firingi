/**
 * SAF-T (PT) 1.04_01 — monthly invoicing file FIRINGI must submit to the Tax Authority (AT).
 * Covers FIRINGI's own sales documents (FT / FR / NC) of one legal entity for one month:
 * Header, MasterFiles (Customer, Product, TaxTable) and SourceDocuments/SalesInvoices.
 * Also checks each series' hash chain and numbering (gaps / broken chain = not compliant).
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { internalProvider, invoiceProvider } from "./provider";

const TYPE = { INVOICE: "FT", INVOICE_RECEIPT: "FR", CREDIT_NOTE: "NC" } as const;
const SOFTWARE = { productId: "FIRINGI/FIRINGI Lda", version: "1.0" };

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tag = (name: string, value: unknown) => `<${name}>${esc(value)}</${name}>`;
const money = (v: Decimal.Value) => new Decimal(v).toFixed(2);
const day = (d: Date) => d.toISOString().slice(0, 10);
const stamp = (d: Date) => d.toISOString().slice(0, 19);
/** NIF digits only (PT), "999999990" for unknown / final consumer. */
const nif = (v: string | null | undefined) => (v ?? "").replace(/^[A-Z]{2}/, "").replace(/\D/g, "") || "999999990";

/** SAF-T tax code from the rate (PT mainland / islands use the same codes). */
export function taxCode(rate: Decimal.Value, explicit?: string | null) {
  if (explicit) return explicit;
  const r = new Decimal(rate);
  if (r.isZero()) return "ISE";
  if (r.gte(18)) return "NOR";
  if (r.gte(9)) return "INT";
  return "RED";
}

export function assertSaftAccess(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.tax.manage", "admin.invoices.view"])) throw new ForbiddenError();
}

export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationError("Choose a month (YYYY-MM).");
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)), year: y };
}

async function documents(legalEntityId: string, start: Date, end: Date) {
  return prisma.invoice.findMany({
    where: { legalEntityId, status: { not: "DRAFT" }, issuedAt: { gte: start, lt: end } },
    include: {
      lines: { orderBy: { position: "asc" }, include: { orderLine: { select: { sku: true, productName: true } }, exemptionReason: true } },
      originalInvoice: { select: { fullNumber: true, issuedAt: true } },
      order: { select: { deliveryAddress: true } },
      recipient: { select: { id: true, legalName: true, taxId: true, vatNumber: true, country: { select: { code: true } } } },
    },
    orderBy: [{ seriesId: "asc" }, { number: "asc" }],
  });
}

/** Hash chain and numbering per series, for everything issued up to `end`. */
export async function checkSeries(legalEntityId: string, end: Date) {
  const series = await prisma.invoiceSeries.findMany({ where: { legalEntityId }, orderBy: [{ year: "desc" }, { prefix: "asc" }] });
  const out = [];
  for (const s of series) {
    const docs = await prisma.invoice.findMany({ where: { seriesId: s.id, status: { not: "DRAFT" }, issuedAt: { lt: end } }, orderBy: { number: "asc" }, select: { number: true, fullNumber: true, hash: true, previousHash: true, atcud: true } });
    const problems: string[] = [];
    docs.forEach((d, i) => {
      if (d.number !== i + 1) problems.push(`Numbering gap before ${d.fullNumber}`);
      const prev = i ? docs[i - 1].hash : null;
      if ((d.previousHash ?? null) !== (prev ?? null)) problems.push(`Hash chain broken at ${d.fullNumber}`);
      if (!d.hash) problems.push(`${d.fullNumber} has no hash`);
      if (!d.atcud) problems.push(`${d.fullNumber} has no ATCUD`);
    });
    if (!s.atcudValidationCode && docs.length) problems.push("Series not communicated to AT (no validation code)");
    out.push({ id: s.id, name: `${s.prefix} ${s.year}`, docType: s.docType, validationCode: s.atcudValidationCode, documents: docs.length, ok: problems.length === 0, problems: problems.slice(0, 10) });
  }
  return out;
}

export async function saftOverview(ctx: Ctx, month: string, legalEntityId?: string) {
  assertSaftAccess(ctx);
  const entities = await prisma.legalEntity.findMany({ where: { isActive: true }, include: { country: { select: { code: true } } }, orderBy: { legalName: "asc" } });
  const pt = entities.filter((e) => e.country.code === "PT");
  const le = pt.find((e) => e.id === legalEntityId) ?? pt[0] ?? null;
  const { start, end } = monthRange(month);
  if (!le) return { entities: pt, entity: null, month, totals: null, series: [], certified: false };
  const docs = await documents(le.id, start, end);
  const sum = (t: string) => docs.filter((d) => TYPE[d.docType] === t).reduce((a, d) => a.plus(d.netTotal.toString()), new Decimal(0));
  const certified = isCertifiedProvider();
  return {
    entities: pt, entity: le, month, certified,
    totals: { documents: docs.length, invoices: docs.filter((d) => d.docType !== "CREDIT_NOTE").length, creditNotes: docs.filter((d) => d.docType === "CREDIT_NOTE").length, credit: Number(sum("FT").plus(sum("FR"))), debit: Number(sum("NC")) },
    series: await checkSeries(le.id, end),
  };
}

/** The active provider is AT-certified (the internal development provider is not). */
export function isCertifiedProvider() {
  return invoiceProvider() !== internalProvider;
}

/** Build the SAF-T (PT) XML for one legal entity and month. */
export async function buildSaft(ctx: Ctx, legalEntityId: string, month: string) {
  assertSaftAccess(ctx);
  const le = await prisma.legalEntity.findUnique({ where: { id: legalEntityId }, include: { country: { select: { code: true } } } });
  if (!le || le.country.code !== "PT") throw new NotFoundError("Portuguese legal entity");
  const { start, end, year } = monthRange(month);
  const docs = await documents(le.id, start, end);
  const regionIds = [...new Set(docs.map((d) => (d.order?.deliveryAddress as { regionId?: string | null } | null)?.regionId).filter(Boolean) as string[])];
  const regions = new Map((await prisma.region.findMany({ where: { id: { in: regionIds } }, select: { id: true, taxRegionCode: true } })).map((r) => [r.id, r.taxRegionCode]));
  const regionOf = (d: (typeof docs)[number]) => {
    const id = (d.order?.deliveryAddress as { regionId?: string | null } | null)?.regionId;
    return (id && regions.get(id)) || "PT";
  };

  // MasterFiles
  const customers = new Map<string, string>();
  const products = new Map<string, string>();
  const taxes = new Map<string, string>();
  for (const d of docs) {
    const snap = d.recipientSnapshot as { name?: string; taxId?: string; vatNumber?: string | null; address?: string | null; country?: string };
    if (!customers.has(d.recipientCompanyId)) {
      const country = snap.country ?? d.recipient.country.code;
      const addr = snap.address ?? "Desconhecido";
      const postal = addr.match(/(\d{4}-\d{3})\s+(.+)$/);
      customers.set(d.recipientCompanyId, `<Customer>${tag("CustomerID", d.recipientCompanyId)}${tag("AccountID", "Desconhecido")}${tag("CustomerTaxID", country === "PT" ? nif(snap.taxId ?? d.recipient.taxId) : (snap.vatNumber ?? d.recipient.vatNumber ?? snap.taxId ?? "999999990"))}${tag("CompanyName", snap.name ?? d.recipient.legalName)}<BillingAddress>${tag("AddressDetail", postal ? addr.slice(0, postal.index).replace(/,\s*$/, "") || addr : addr)}${tag("City", postal?.[2] ?? "Desconhecido")}${tag("PostalCode", postal?.[1] ?? "0000-000")}${tag("Country", country)}</BillingAddress>${tag("SelfBillingIndicator", 0)}</Customer>`);
    }
    for (const l of d.lines) {
      const code = l.orderLine?.sku ?? "FIRINGI-ENTREGA";
      if (!products.has(code)) {
        const name = l.orderLine ? (l.orderLine.productName as Record<string, string>).pt ?? (l.orderLine.productName as Record<string, string>).en : "Entrega (FIRINGI)";
        products.set(code, `<Product>${tag("ProductType", l.orderLine ? "P" : "S")}${tag("ProductCode", code)}${tag("ProductDescription", name)}${tag("ProductNumberCode", code)}</Product>`);
      }
      const region = regionOf(d);
      const tc = taxCode(l.taxRate.toString(), l.saftTaxCode);
      const key = `${region}|${tc}|${new Decimal(l.taxRate.toString()).toFixed(2)}`;
      if (!taxes.has(key))
        taxes.set(key, `<TaxTableEntry>${tag("TaxType", "IVA")}${tag("TaxCountryRegion", region)}${tag("TaxCode", tc)}${tag("Description", { NOR: "Taxa normal", INT: "Taxa intermédia", RED: "Taxa reduzida", ISE: "Isenta" }[tc] ?? tc)}${tag("TaxPercentage", new Decimal(l.taxRate.toString()).toFixed(2))}</TaxTableEntry>`);
    }
  }

  // SalesInvoices
  let totalDebit = new Decimal(0), totalCredit = new Decimal(0);
  const invoices = docs.map((d) => {
    const type = TYPE[d.docType];
    const credit = type === "NC";
    if (credit) totalDebit = totalDebit.plus(d.netTotal.toString()); else totalCredit = totalCredit.plus(d.netTotal.toString());
    const issued = d.issuedAt!;
    const region = regionOf(d);
    const reason = (d.recipientSnapshot as { reason?: string }).reason ?? "Retificação";
    const lines = d.lines.map((l, i) => {
      const qty = new Decimal(l.qty.toString());
      const unit = qty.isZero() ? new Decimal(0) : new Decimal(l.lineNet.toString()).div(qty);
      const rate = new Decimal(l.taxRate.toString());
      const tc = taxCode(rate, l.saftTaxCode);
      const exempt = rate.isZero() ? `${tag("TaxExemptionReason", l.exemptionReason ? ((l.exemptionReason.text as Record<string, string>).pt ?? l.exemptionReason.code) : "Isento")}${tag("TaxExemptionCode", l.exemptionReason?.code ?? "M99")}` : "";
      const ref = credit && d.originalInvoice ? `<References>${tag("Reference", d.originalInvoice.fullNumber)}${tag("Reason", reason)}</References>` : "";
      return `<Line>${tag("LineNumber", i + 1)}${tag("ProductCode", l.orderLine?.sku ?? "FIRINGI-ENTREGA")}${tag("ProductDescription", l.description)}${tag("Quantity", qty.toFixed(3))}${tag("UnitOfMeasure", l.orderLine ? "UN" : "SERV")}${tag("UnitPrice", unit.toFixed(6))}${tag("TaxPointDate", day(issued))}${ref}${tag("Description", l.description)}${tag(credit ? "DebitAmount" : "CreditAmount", money(l.lineNet.toString()))}<Tax>${tag("TaxType", "IVA")}${tag("TaxCountryRegion", region)}${tag("TaxCode", tc)}${tag("TaxPercentage", rate.toFixed(2))}</Tax>${exempt}${tag("SettlementAmount", money(l.discountNet.toString()))}</Line>`;
    });
    return `<Invoice>${tag("InvoiceNo", d.fullNumber)}${tag("ATCUD", d.atcud ?? "0")}<DocumentStatus>${tag("InvoiceStatus", "N")}${tag("InvoiceStatusDate", stamp(issued))}${tag("SourceID", d.createdById ?? "Sistema")}${tag("SourceBilling", "P")}</DocumentStatus>${tag("Hash", d.hash ?? "0")}${tag("HashControl", isCertifiedProvider() ? "1" : "0")}${tag("Period", issued.getUTCMonth() + 1)}${tag("InvoiceDate", day(issued))}${tag("InvoiceType", type)}<SpecialRegimes>${tag("SelfBillingIndicator", 0)}${tag("CashVATSchemeIndicator", 0)}${tag("ThirdPartiesBillingIndicator", 0)}</SpecialRegimes>${tag("SourceID", d.createdById ?? "Sistema")}${tag("SystemEntryDate", stamp(d.createdAt))}${tag("CustomerID", d.recipientCompanyId)}${lines.join("")}<DocumentTotals>${tag("TaxPayable", money(d.vatTotal.toString()))}${tag("NetTotal", money(d.netTotal.toString()))}${tag("GrossTotal", money(d.grossTotal.toString()))}</DocumentTotals></Invoice>`;
  });

  const header = `<Header>${tag("AuditFileVersion", "1.04_01")}${tag("CompanyID", nif(le.taxId))}${tag("TaxRegistrationNumber", nif(le.taxId))}${tag("TaxAccountingBasis", "F")}${tag("CompanyName", le.legalName)}${tag("BusinessName", "FIRINGI")}<CompanyAddress>${tag("AddressDetail", le.addressLine)}${tag("City", le.city)}${tag("PostalCode", le.postalCode)}${tag("Country", "PT")}</CompanyAddress>${tag("FiscalYear", year)}${tag("StartDate", day(start))}${tag("EndDate", day(new Date(end.getTime() - 86400_000)))}${tag("CurrencyCode", "EUR")}${tag("DateCreated", day(new Date()))}${tag("TaxEntity", "Global")}${tag("ProductCompanyTaxID", nif(le.taxId))}${tag("SoftwareCertificateNumber", isCertifiedProvider() ? process.env.SAFT_CERTIFICATE_NUMBER ?? "0" : "0")}${tag("ProductID", SOFTWARE.productId)}${tag("ProductVersion", SOFTWARE.version)}${le.phone ? tag("Telephone", le.phone) : ""}${tag("Email", le.email)}</Header>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01">${header}<MasterFiles>${[...customers.values()].join("")}${[...products.values()].join("")}<TaxTable>${[...taxes.values()].join("")}</TaxTable></MasterFiles><SourceDocuments><SalesInvoices>${tag("NumberOfEntries", docs.length)}${tag("TotalDebit", money(totalDebit))}${tag("TotalCredit", money(totalCredit))}${invoices.join("")}</SalesInvoices></SourceDocuments></AuditFile>\n`;
  return { xml, filename: `SAFT-PT_${nif(le.taxId)}_${month}.xml`, documents: docs.length };
}
