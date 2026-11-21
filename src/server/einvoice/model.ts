/**
 * Phase 46 — FIRINGI's documents in the neutral e-invoice shape (EDoc): sales invoices, credit notes, service
 * invoices and self-billed supplier invoices. Amounts are in the document's currency (Phase 45: the customer's /
 * supplier's currency when the document has local amounts), with the VAT in EUR alongside.
 */
import "server-only";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { docTexts, localizeLine } from "./doc-i18n";
import type { EDoc, EParty, ELine, ETax, VatCategory } from "./types";

const D = (v: { toString(): string } | string | number | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const f2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

type Addr = { line1: string; line2: string | null; postalCode: string; cityName: string } | null;

async function billingAddress(companyId: string): Promise<Addr> {
  return (await prisma.address.findFirst({ where: { companyId, isActive: true, kind: "BILLING" }, orderBy: { isDefault: "desc" } }))
    ?? (await prisma.address.findFirst({ where: { companyId, isActive: true, kind: "HEAD_OFFICE" } }));
}

/** VAT id with the country prefix (GR → EL), from a stored number that may or may not have it. */
export function vatWithPrefix(vat: string | null | undefined, cc: string): string | null {
  const v = (vat ?? "").replace(/\s+/g, "").toUpperCase();
  if (!v) return null;
  const p = cc === "GR" ? "EL" : cc;
  return /^[A-Z]{2}/.test(v) ? v : `${p}${v}`;
}

async function companyParty(companyId: string): Promise<EParty & { profile: Awaited<ReturnType<typeof profileOf>> }> {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { country: true } });
  const a = await billingAddress(companyId);
  const profile = await profileOf(companyId);
  return {
    name: c.legalName, vatId: vatWithPrefix(c.vatNumber, c.country.code), taxId: c.taxId, countryCode: c.country.code,
    street: a ? `${a.line1}${a.line2 ? `, ${a.line2}` : ""}` : null, city: a?.cityName ?? null, postalCode: a?.postalCode ?? null,
    email: profile?.invoiceEmail ?? c.email, phone: c.phone, peppolId: profile?.peppolId ?? null, profile,
  };
}

export const profileOf = (companyId: string) => prisma.eInvoiceProfile.findUnique({ where: { companyId } });

async function entityParty(legalEntityId: string): Promise<EParty & { language: string | null; secondLanguage: string | null; requireOwnLanguage: boolean; countryLanguage: string }> {
  const le = await prisma.legalEntity.findUniqueOrThrow({ where: { id: legalEntityId }, include: { country: true } });
  return {
    name: le.legalName, vatId: vatWithPrefix(le.vatNumber, le.country.code), taxId: le.taxId, countryCode: le.country.code,
    street: le.addressLine, city: le.city, postalCode: le.postalCode, email: le.email, phone: le.phone, peppolId: le.peppolId, iban: le.iban,
    language: le.language, secondLanguage: le.secondLanguage, requireOwnLanguage: le.requireOwnLanguage, countryLanguage: le.country.defaultLanguageCode,
  };
}

function category(rate: Decimal, regime: string): VatCategory {
  if (regime === "INTRA_EU_REVERSE_CHARGE") return "AE";
  if (regime === "INTRA_EU_SUPPLY") return "K";
  if (regime === "EXEMPT") return "E";
  return rate.gt(0) ? "S" : "Z";
}

function taxBreakdown(lines: { net: Decimal; vat: Decimal; rate: Decimal }[], regime: string, lang: string): ETax[] {
  const t = docTexts(lang);
  const by = new Map<string, { base: Decimal; vat: Decimal; rate: Decimal }>();
  for (const l of lines) {
    const k = l.rate.toFixed(3);
    const cur = by.get(k) ?? { base: new Decimal(0), vat: new Decimal(0), rate: l.rate };
    by.set(k, { base: cur.base.plus(l.net), vat: cur.vat.plus(l.vat), rate: l.rate });
  }
  return [...by.values()].map((x) => {
    const c = category(x.rate, regime);
    return {
      category: c, rate: x.rate.toString(), base: f2(x.base), vat: f2(x.vat),
      ...(c === "AE" ? { exemptionCode: "VATEX-EU-AE", exemptionText: t.reverseCharge } : c === "K" ? { exemptionCode: "VATEX-EU-IC", exemptionText: t.intraEuSupply } : c === "E" ? { exemptionCode: "VATEX-EU-132", exemptionText: "Exempt" } : {}),
    };
  });
}

/** A FIRINGI invoice / credit note (customer or service) as an EDoc, in its language. */
export async function invoiceEDoc(invoiceId: string): Promise<{ doc: EDoc; kind: EDoc["kind"]; recipientId: string; legalEntityId: string; language: string; secondLanguage: string | null }> {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { position: "asc" }, include: { orderLine: { select: { productName: true, packagingName: true, sku: true } } } },
      order: { select: { number: true, poReference: true } }, originalInvoice: { select: { fullNumber: true, providerNumber: true, issuedAt: true } },
      recipient: { select: { type: true } },
    },
  });
  const seller = await entityParty(inv.legalEntityId);
  const buyer = await companyParty(inv.recipientCompanyId);
  const lang = inv.language ?? seller.language ?? seller.countryLanguage;
  const second = inv.secondLanguage;
  const local = inv.currencyCode !== "EUR" && inv.netTotalLocal != null;
  const kind: EDoc["kind"] = inv.docType === "CREDIT_NOTE" ? "CREDIT_NOTE" : !inv.orderId ? "SERVICE_INVOICE" : "INVOICE";
  const rows = inv.lines.map((l) => {
    const net = local ? D(l.lineNetLocal) : D(l.lineNet);
    const vat = local ? D(l.lineVatLocal) : D(l.lineVat);
    const rate = D(l.taxRate);
    const qty = D(l.qty);
    const list = local ? D(l.unitPriceLocal ?? 0) : D(l.unitPriceNet);
    return { l, net, vat, rate, qty, list };
  });
  const lines: ELine[] = rows.map(({ l, net, rate, qty, list }, i) => ({
    id: String(i + 1),
    name: localizeLine(l, lang),
    name2: second ? localizeLine(l, second) : null,
    sku: l.orderLine?.sku ?? null,
    qty: qty.toString(), unitCode: "C62",
    price: qty.isZero() ? f2(net) : net.div(qty).toDecimalPlaces(6).toString(), listPrice: list.toString(), discount: f2(Decimal.max(0, list.mul(qty).minus(net))),
    net: f2(net), vatCategory: category(rate, inv.taxRegime), vatRate: rate.toString(),
  }));
  const taxes = taxBreakdown(rows.map((r) => ({ net: r.net, vat: r.vat, rate: r.rate })), inv.taxRegime, lang);
  const lineNet = rows.reduce((a, r) => a.plus(r.net), new Decimal(0));
  const net = local ? D(inv.netTotalLocal) : D(inv.netTotal);
  const vat = local ? D(inv.vatTotalLocal) : D(inv.vatTotal);
  const gross = local ? D(inv.grossTotalLocal) : D(inv.grossTotal);
  // a local document's totals are worked out on the local lines; the line sums are the legal amounts
  const sumNet = taxes.reduce((a, t) => a.plus(t.base), new Decimal(0));
  const sumVat = taxes.reduce((a, t) => a.plus(t.vat), new Decimal(0));
  const useNet = sumNet.minus(net).abs().lte(0.05) ? sumNet : net;
  const useVat = sumVat.minus(vat).abs().lte(0.05) ? sumVat : vat;
  const useGross = useNet.plus(useVat).minus(gross).abs().lte(0.05) ? useNet.plus(useVat) : gross;
  const paid = inv.docType === "INVOICE_RECEIPT" ? useGross : new Decimal(0);
  const number = inv.providerNumber ?? inv.fullNumber ?? inv.id;
  const t = docTexts(lang);
  const splitFrom = Number(((await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: "einvoice.settings" } }))?.value as { plSplitPaymentFrom?: number } | undefined)?.plSplitPaymentFrom ?? 15000);
  // Poland's split-payment mention: the gross in PLN (an EUR document at the latest PLN rate)
  let plnGross = useGross;
  if (seller.countryCode === "PL" && (local ? inv.currencyCode : "EUR") !== "PLN") {
    const r = await prisma.exchangeRate.findFirst({ where: { baseCode: "EUR", quoteCode: "PLN" }, orderBy: { date: "desc" }, select: { rate: true } });
    plnGross = D(inv.grossTotal).mul(r ? r.rate.toString() : "4.3");
  }
  const doc: EDoc = {
    typeCode: inv.docType === "CREDIT_NOTE" ? "381" : "380",
    kind, number,
    issueDate: day(inv.issuedAt) ?? day(new Date())!,
    dueDate: inv.docType === "CREDIT_NOTE" ? null : day(inv.dueAt),
    currency: local ? inv.currencyCode : "EUR",
    vatInEur: local ? f2(D(inv.vatTotal)) : null,
    seller, buyer,
    buyerReference: buyer.profile?.leitwegId ?? inv.order?.poReference ?? null,
    orderReference: inv.order?.number ?? null,
    preceding: inv.originalInvoice ? { number: inv.originalInvoice.providerNumber ?? inv.originalInvoice.fullNumber ?? "", issueDate: day(inv.originalInvoice.issuedAt) } : null,
    notes: [
      ...((inv.recipientSnapshot as { reason?: string }).reason ? [(inv.recipientSnapshot as { reason: string }).reason] : []),
      ...(inv.order ? [`${t.order} ${inv.order.number}`] : []),
    ],
    lines, taxes,
    totals: { lineNet: f2(lineNet), net: f2(useNet), vat: f2(useVat), gross: f2(useGross), paid: f2(paid), payable: f2(useGross.minus(paid)) },
    payment: inv.docType === "CREDIT_NOTE" ? null : { meansCode: "58", iban: seller.iban ?? null, reference: number, terms: null },
    language: lang,
    extra: {
      sdiCode: buyer.profile?.sdiCode ?? null, pec: buyer.profile?.pecEmail ?? null, ksefBuyerNip: buyer.profile?.ksefNip ?? null,
      splitPayment: seller.countryCode === "PL" && splitFrom > 0 && plnGross.gte(splitFrom),
    },
  };
  return { doc, kind, recipientId: inv.recipientCompanyId, legalEntityId: inv.legalEntityId, language: lang, secondLanguage: second };
}

type StLine = { sku: string; description: string; qty: number; unitCostNet: string; lineNet: string; taxRate: string; vat: string };

/** A self-billed supplier invoice (from a billing statement) as an EDoc: seller = the supplier, buyer = FIRINGI. */
export async function statementEDoc(statementId: string): Promise<{ doc: EDoc; kind: EDoc["kind"]; supplierId: string; legalEntityId: string; language: string }> {
  const st = await prisma.vendorBillingStatement.findUniqueOrThrow({
    where: { id: statementId },
    include: { order: { select: { number: true, countryId: true } }, salesInvoice: { select: { legalEntityId: true } } },
  });
  const leId = st.salesInvoice?.legalEntityId ?? (await prisma.legalEntity.findFirstOrThrow({ where: { countryId: st.order.countryId, isActive: true } })).id;
  const seller = await companyParty(st.vendorCompanyId);
  const buyer = await entityParty(leId);
  const sellerCountry = await prisma.country.findUniqueOrThrow({ where: { code: seller.countryCode } });
  const lang = seller.profile?.invoiceLanguage ?? sellerCountry.defaultLanguageCode;
  const local = st.currencyCode !== "EUR" && st.expectedNetLocal != null;
  const rate = D(st.rate);
  const raw = st.lines as StLine[];
  // lines in the supplier's currency: converted at the statement's rate, the last line takes the rounding
  let given = new Decimal(0);
  const target = local ? D(st.expectedNetLocal) : D(st.expectedNet);
  const rows = raw.map((l, i) => {
    let net = local ? D(l.lineNet).mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : D(l.lineNet);
    if (local && i === raw.length - 1) net = target.minus(given);
    given = given.plus(net);
    const r = D(l.taxRate);
    return { l, net, rate: r, vat: net.mul(r).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
  });
  const t = docTexts(lang);
  const lines: ELine[] = rows.map(({ l, net, rate: r }, i) => ({
    id: String(i + 1), name: localizeLine({ description: l.description }, lang), sku: l.sku, qty: String(l.qty), unitCode: "C62",
    price: l.qty ? net.div(l.qty).toDecimalPlaces(6).toString() : f2(net), listPrice: net.div(l.qty || 1).toString(), discount: "0", net: f2(net),
    vatCategory: category(r, st.taxRegime), vatRate: r.toString(),
  }));
  const taxes = taxBreakdown(rows.map((r) => ({ net: r.net, vat: r.vat, rate: r.rate })), st.taxRegime, lang);
  const net = taxes.reduce((a, x) => a.plus(x.base), new Decimal(0));
  const vat = taxes.reduce((a, x) => a.plus(x.vat), new Decimal(0));
  const kind: EDoc["kind"] = st.isCreditStatement ? "SELF_BILLED_CREDIT" : "SELF_BILLED";
  const doc: EDoc = {
    typeCode: st.isCreditStatement ? "261" : "389", kind,
    number: st.selfBilledNumber ?? st.number,
    issueDate: day(st.selfBilledAt ?? st.createdAt)!,
    dueDate: null,
    currency: local ? st.currencyCode : "EUR",
    vatInEur: local ? f2(D(st.expectedVat)) : null,
    seller, buyer,
    buyerReference: st.number, orderReference: st.order.number, preceding: null,
    notes: [t.selfBilling, ...(seller.profile?.selfBillingAgreement ? [`${t.agreement}: ${seller.profile.selfBillingAgreement}`] : []), `${t.order} ${st.order.number}`],
    lines, taxes,
    totals: { lineNet: f2(net), net: f2(net), vat: f2(vat), gross: f2(net.plus(vat)), paid: "0.00", payable: f2(net.plus(vat)) },
    payment: { meansCode: "58", iban: null, reference: st.number, terms: null },
    language: lang,
    extra: { ksefSellerNip: seller.taxId, ksefBuyerNip: buyer.taxId },
  };
  return { doc, kind, supplierId: st.vendorCompanyId, legalEntityId: leId, language: lang };
}
