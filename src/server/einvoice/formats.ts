/**
 * Phase 46 — e-invoice formats, generated from the neutral EDoc:
 *   UBL 2.1 Peppol BIS Billing 3.0 (invoice / credit note) and its German CIUS XRechnung 3.0,
 *   UN/CEFACT CII D16B (EN 16931 profile) for Factur-X / ZUGFeRD,
 *   Poland's KSeF FA(3), Italy's FatturaPA 1.2 (FPR12), Spain's Verifactu "RegistroAlta".
 * Built to the published specifications; each network's own validator is the final word before go-live.
 */
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { EFormat } from "@/lib/einvoice";
import { amt, el, toXml, type XNode } from "./xml";
import type { EDoc, EParty, ETax, VatCategory } from "./types";

const D = (v: string | number) => new Decimal(v);
const blank = (tag: string): XNode => ({ tag, text: "" });

/** The ISO 6523 ICD scheme and the id of a Peppol participant id "0208:0123…". */
export function splitPeppol(id: string | null | undefined): { scheme: string; id: string } | null {
  const m = /^(\d{4}):(.+)$/.exec(id ?? "");
  return m ? { scheme: m[1], id: m[2] } : null;
}

/** Unit price that gives exactly the line amount (Peppol rule R120): up to 6 decimals, or per base quantity. */
function linePrice(qty: string, net: string): { price: string; baseQty: string | null } {
  const q = D(qty);
  if (q.isZero()) return { price: amt(net), baseQty: null };
  const p = D(net).div(q).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  if (p.mul(q).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(D(net))) return { price: p.toFixed(Math.max(2, p.decimalPlaces())), baseQty: null };
  return { price: amt(net), baseQty: q.toString() };
}

// ── UBL (Peppol BIS 3 / XRechnung) ──────────────────────────────────────────

const UBL_NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cn: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};
const PEPPOL_CUSTOMIZATION = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const XRECHNUNG_CUSTOMIZATION = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

function ublParty(p: EParty, role: "seller" | "buyer"): XNode {
  const ep = splitPeppol(p.peppolId);
  return el("cac:Party", null, [
    ep ? el("cbc:EndpointID", { schemeID: ep.scheme }, ep.id) : p.email ? el("cbc:EndpointID", { schemeID: "EM" }, p.email) : null,
    el("cac:PartyName", null, [el("cbc:Name", null, p.name)]),
    el("cac:PostalAddress", null, [
      el("cbc:StreetName", null, p.street), el("cbc:CityName", null, p.city), el("cbc:PostalZone", null, p.postalCode),
      el("cac:Country", null, [el("cbc:IdentificationCode", null, p.countryCode)]),
    ]),
    p.vatId ? el("cac:PartyTaxScheme", null, [el("cbc:CompanyID", null, p.vatId), el("cac:TaxScheme", null, [el("cbc:ID", null, "VAT")])]) : null,
    el("cac:PartyLegalEntity", null, [el("cbc:RegistrationName", null, p.name), el("cbc:CompanyID", null, p.taxId)]),
    role === "seller" || p.email ? el("cac:Contact", null, [el("cbc:Name", null, role === "seller" ? p.name : null), el("cbc:Telephone", null, p.phone ?? null), el("cbc:ElectronicMail", null, p.email)]) : null,
  ])!;
}

function ublTaxCategory(tag: string, c: VatCategory, rate: string, t?: ETax): XNode {
  return el(tag, null, [
    el("cbc:ID", null, c),
    c === "O" ? null : el("cbc:Percent", null, D(rate).toString()),
    t?.exemptionCode ? el("cbc:TaxExemptionReasonCode", null, t.exemptionCode) : null,
    t?.exemptionText ? el("cbc:TaxExemptionReason", null, t.exemptionText) : null,
    el("cac:TaxScheme", null, [el("cbc:ID", null, "VAT")]),
  ])!;
}

export function toUbl(d: EDoc, variant: "PEPPOL_BIS3" | "XRECHNUNG"): string {
  const credit = d.typeCode === "381" || d.typeCode === "261";
  const cur = { currencyID: d.currency };
  const lineTag = credit ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const qtyTag = credit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  const root: XNode = {
    tag: credit ? "CreditNote" : "Invoice",
    attrs: { xmlns: credit ? UBL_NS.cn : UBL_NS.inv, "xmlns:cac": UBL_NS.cac, "xmlns:cbc": UBL_NS.cbc },
    children: [
      el("cbc:CustomizationID", null, variant === "XRECHNUNG" ? XRECHNUNG_CUSTOMIZATION : PEPPOL_CUSTOMIZATION),
      el("cbc:ProfileID", null, "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"),
      el("cbc:ID", null, d.number),
      el("cbc:IssueDate", null, d.issueDate),
      credit ? null : el("cbc:DueDate", null, d.dueDate),
      el(credit ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode", null, d.typeCode),
      ...d.notes.map((n) => el("cbc:Note", null, n)),
      el("cbc:DocumentCurrencyCode", null, d.currency),
      d.vatInEur ? el("cbc:TaxCurrencyCode", null, "EUR") : null,
      el("cbc:BuyerReference", null, d.buyerReference ?? (variant === "XRECHNUNG" ? null : d.orderReference)),
      d.orderReference ? el("cac:OrderReference", null, [el("cbc:ID", null, d.orderReference)]) : null,
      d.preceding ? el("cac:BillingReference", null, [el("cac:InvoiceDocumentReference", null, [el("cbc:ID", null, d.preceding.number), el("cbc:IssueDate", null, d.preceding.issueDate)])]) : null,
      el("cac:AccountingSupplierParty", null, [ublParty(d.seller, "seller")]),
      el("cac:AccountingCustomerParty", null, [ublParty(d.buyer, "buyer")]),
      d.payment ? el("cac:PaymentMeans", null, [
        el("cbc:PaymentMeansCode", null, d.payment.meansCode),
        credit ? el("cbc:PaymentDueDate", null, d.dueDate) : null,
        el("cbc:PaymentID", null, d.payment.reference),
        d.payment.iban ? el("cac:PayeeFinancialAccount", null, [el("cbc:ID", null, d.payment.iban.replace(/\s+/g, ""))]) : null,
      ]) : null,
      d.payment?.terms ? el("cac:PaymentTerms", null, [el("cbc:Note", null, d.payment.terms)]) : null,
      el("cac:TaxTotal", null, [
        el("cbc:TaxAmount", cur, amt(d.totals.vat)),
        ...d.taxes.map((t) => el("cac:TaxSubtotal", null, [
          el("cbc:TaxableAmount", cur, amt(t.base)), el("cbc:TaxAmount", cur, amt(t.vat)), ublTaxCategory("cac:TaxCategory", t.category, t.rate, t),
        ])),
      ]),
      d.vatInEur ? el("cac:TaxTotal", null, [el("cbc:TaxAmount", { currencyID: "EUR" }, amt(d.vatInEur))]) : null,
      el("cac:LegalMonetaryTotal", null, [
        el("cbc:LineExtensionAmount", cur, amt(d.totals.lineNet)),
        el("cbc:TaxExclusiveAmount", cur, amt(d.totals.net)),
        el("cbc:TaxInclusiveAmount", cur, amt(d.totals.gross)),
        D(d.totals.lineNet).eq(D(d.totals.net)) ? null : el("cbc:ChargeTotalAmount", cur, amt(D(d.totals.net).minus(d.totals.lineNet).toString())),
        D(d.totals.paid).isZero() ? null : el("cbc:PrepaidAmount", cur, amt(d.totals.paid)),
        el("cbc:PayableAmount", cur, amt(d.totals.payable)),
      ]),
      ...d.lines.map((l) => {
        const p = linePrice(l.qty, l.net);
        return el(lineTag, null, [
          el("cbc:ID", null, l.id),
          el(qtyTag, { unitCode: l.unitCode }, D(l.qty).toString()),
          el("cbc:LineExtensionAmount", cur, amt(l.net)),
          el("cac:Item", null, [
            el("cbc:Description", null, l.name2 ?? null),
            el("cbc:Name", null, l.name.slice(0, 250)),
            l.sku ? el("cac:SellersItemIdentification", null, [el("cbc:ID", null, l.sku)]) : null,
            ublTaxCategory("cac:ClassifiedTaxCategory", l.vatCategory, l.vatRate),
          ]),
          el("cac:Price", null, [el("cbc:PriceAmount", cur, p.price), p.baseQty ? el("cbc:BaseQuantity", { unitCode: l.unitCode }, p.baseQty) : null]),
        ]);
      }),
    ].filter(Boolean) as XNode[],
  };
  return toXml(root);
}

// ── CII (Factur-X EN 16931 profile) ─────────────────────────────────────────

const ymd = (iso: string | null) => (iso ?? "").replace(/-/g, "").slice(0, 8);
const ciiDate = (tag: string, iso: string | null) => (iso ? el(tag, null, [el("udt:DateTimeString", { format: "102" }, ymd(iso))]) : null);

function ciiParty(tag: string, p: EParty): XNode {
  return el(tag, null, [
    el("ram:Name", null, p.name),
    p.taxId ? el("ram:SpecifiedLegalOrganization", null, [el("ram:ID", null, p.taxId)]) : null,
    el("ram:PostalTradeAddress", null, [el("ram:PostcodeCode", null, p.postalCode), el("ram:LineOne", null, p.street), el("ram:CityName", null, p.city), el("ram:CountryID", null, p.countryCode)]),
    p.email ? el("ram:URIUniversalCommunication", null, [el("ram:URIID", { schemeID: "EM" }, p.email)]) : null,
    p.vatId ? el("ram:SpecifiedTaxRegistration", null, [el("ram:ID", { schemeID: "VA" }, p.vatId)]) : null,
  ])!;
}

export function toCii(d: EDoc): string {
  const cur = { currencyID: d.currency };
  const root: XNode = {
    tag: "rsm:CrossIndustryInvoice",
    attrs: {
      "xmlns:rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
      "xmlns:ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
      "xmlns:qdt": "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
      "xmlns:udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
    },
    children: [
      el("rsm:ExchangedDocumentContext", null, [el("ram:GuidelineSpecifiedDocumentContextParameter", null, [el("ram:ID", null, "urn:cen.eu:en16931:2017")])]),
      el("rsm:ExchangedDocument", null, [
        el("ram:ID", null, d.number), el("ram:TypeCode", null, d.typeCode), ciiDate("ram:IssueDateTime", d.issueDate),
        ...d.notes.map((n) => el("ram:IncludedNote", null, [el("ram:Content", null, n)])),
      ]),
      el("rsm:SupplyChainTradeTransaction", null, [
        ...d.lines.map((l) => el("ram:IncludedSupplyChainTradeLineItem", null, [
          el("ram:AssociatedDocumentLineDocument", null, [el("ram:LineID", null, l.id)]),
          el("ram:SpecifiedTradeProduct", null, [el("ram:SellerAssignedID", null, l.sku), el("ram:Name", null, l.name.slice(0, 250))]),
          el("ram:SpecifiedLineTradeAgreement", null, [el("ram:NetPriceProductTradePrice", null, [el("ram:ChargeAmount", null, linePrice(l.qty, l.net).price)])]),
          el("ram:SpecifiedLineTradeDelivery", null, [el("ram:BilledQuantity", { unitCode: l.unitCode }, D(l.qty).toString())]),
          el("ram:SpecifiedLineTradeSettlement", null, [
            el("ram:ApplicableTradeTax", null, [el("ram:TypeCode", null, "VAT"), el("ram:CategoryCode", null, l.vatCategory), l.vatCategory === "O" ? null : el("ram:RateApplicablePercent", null, D(l.vatRate).toString())]),
            el("ram:SpecifiedTradeSettlementLineMonetarySummation", null, [el("ram:LineTotalAmount", null, amt(l.net))]),
          ]),
        ])),
        el("ram:ApplicableHeaderTradeAgreement", null, [
          el("ram:BuyerReference", null, d.buyerReference),
          ciiParty("ram:SellerTradeParty", d.seller),
          ciiParty("ram:BuyerTradeParty", d.buyer),
          d.orderReference ? el("ram:BuyerOrderReferencedDocument", null, [el("ram:IssuerAssignedID", null, d.orderReference)]) : null,
        ]),
        blank("ram:ApplicableHeaderTradeDelivery"),
        el("ram:ApplicableHeaderTradeSettlement", null, [
          el("ram:PaymentReference", null, d.payment?.reference ?? null),
          d.vatInEur ? el("ram:TaxCurrencyCode", null, "EUR") : null,
          el("ram:InvoiceCurrencyCode", null, d.currency),
          d.payment ? el("ram:SpecifiedTradeSettlementPaymentMeans", null, [
            el("ram:TypeCode", null, d.payment.meansCode),
            d.payment.iban ? el("ram:PayeePartyCreditorFinancialAccount", null, [el("ram:IBANID", null, d.payment.iban.replace(/\s+/g, ""))]) : null,
          ]) : null,
          ...d.taxes.map((t) => el("ram:ApplicableTradeTax", null, [
            el("ram:CalculatedAmount", null, amt(t.vat)), el("ram:TypeCode", null, "VAT"), el("ram:ExemptionReason", null, t.exemptionText ?? null),
            el("ram:BasisAmount", null, amt(t.base)), el("ram:CategoryCode", null, t.category), el("ram:ExemptionReasonCode", null, t.exemptionCode ?? null),
            t.category === "O" ? null : el("ram:RateApplicablePercent", null, D(t.rate).toString()),
          ])),
          d.dueDate || d.payment?.terms ? el("ram:SpecifiedTradePaymentTerms", null, [el("ram:Description", null, d.payment?.terms ?? null), ciiDate("ram:DueDateDateTime", d.dueDate)]) : null,
          el("ram:SpecifiedTradeSettlementHeaderMonetarySummation", null, [
            el("ram:LineTotalAmount", null, amt(d.totals.lineNet)),
            D(d.totals.lineNet).eq(D(d.totals.net)) ? null : el("ram:ChargeTotalAmount", null, amt(D(d.totals.net).minus(d.totals.lineNet).toString())),
            el("ram:TaxBasisTotalAmount", null, amt(d.totals.net)),
            el("ram:TaxTotalAmount", cur, amt(d.totals.vat)),
            d.vatInEur ? el("ram:TaxTotalAmount", { currencyID: "EUR" }, amt(d.vatInEur)) : null,
            el("ram:GrandTotalAmount", null, amt(d.totals.gross)),
            D(d.totals.paid).isZero() ? null : el("ram:TotalPrepaidAmount", null, amt(d.totals.paid)),
            el("ram:DuePayableAmount", null, amt(d.totals.payable)),
          ]),
          d.preceding ? el("ram:InvoiceReferencedDocument", null, [el("ram:IssuerAssignedID", null, d.preceding.number), ciiDate("ram:FormattedIssueDateTime", d.preceding.issueDate)]) : null,
        ]),
      ]),
    ].filter(Boolean) as XNode[],
  };
  return toXml(root);
}

// ── KSeF FA(3) ──────────────────────────────────────────────────────────────

const KSEF_NS = "http://crd.gov.pl/wzor/2025/06/25/13775/";
const nip = (v: string | null | undefined) => (v ?? "").replace(/^PL/i, "").replace(/\D/g, "");

/** KSeF field pair for a VAT rate / category: P_13_x (net) and P_14_x (VAT). */
function ksefSlot(c: VatCategory, rate: string): { net: string; vat: string | null } {
  const r = Number(rate);
  if (c === "AE") return { net: "P_13_10", vat: null };
  if (c === "K") return { net: "P_13_6_2", vat: null };
  if (c === "E") return { net: "P_13_7", vat: null };
  if (c === "Z" || r === 0) return { net: "P_13_6_1", vat: null };
  if (r >= 22) return { net: "P_13_1", vat: "P_14_1" };
  if (r >= 7) return { net: "P_13_2", vat: "P_14_2" };
  return { net: "P_13_3", vat: "P_14_3" };
}
const KSEF_ORDER = ["P_13_1", "P_14_1", "P_13_2", "P_14_2", "P_13_3", "P_14_3", "P_13_6_1", "P_13_6_2", "P_13_7", "P_13_10"];

function ksefAddress(p: EParty) {
  return el("Adres", null, [el("KodKraju", null, p.countryCode), el("AdresL1", null, p.street ?? "-"), el("AdresL2", null, [p.postalCode, p.city].filter(Boolean).join(" ") || null)]);
}

export function toKsef(d: EDoc, createdAt = new Date()): string {
  const credit = d.typeCode === "381" || d.typeCode === "261";
  const sums = new Map<string, Decimal>();
  for (const t of d.taxes) {
    const s = ksefSlot(t.category, t.rate);
    sums.set(s.net, (sums.get(s.net) ?? D(0)).plus(t.base));
    if (s.vat) sums.set(s.vat, (sums.get(s.vat) ?? D(0)).plus(t.vat));
  }
  const buyerNip = nip(d.extra.ksefBuyerNip ?? (d.buyer.countryCode === "PL" ? d.buyer.taxId ?? d.buyer.vatId : null));
  const eu = d.buyer.countryCode !== "PL" && d.buyer.vatId;
  const reverse = d.taxes.some((t) => t.category === "AE");
  const root: XNode = {
    tag: "Faktura",
    attrs: { xmlns: KSEF_NS },
    children: [
      el("Naglowek", null, [
        el("KodFormularza", { kodSystemowy: "FA (3)", wersjaSchemy: "1-0E" }, "FA"),
        el("WariantFormularza", null, "3"),
        el("DataWytworzeniaFa", null, createdAt.toISOString().replace(/\.\d{3}Z$/, "Z")),
        el("SystemInfo", null, "FIRINGI"),
      ]),
      el("Podmiot1", null, [
        el("DaneIdentyfikacyjne", null, [el("NIP", null, nip(d.extra.ksefSellerNip ?? d.seller.taxId ?? d.seller.vatId)), el("Nazwa", null, d.seller.name)]),
        ksefAddress(d.seller),
        d.seller.email ? el("DaneKontaktowe", null, [el("Email", null, d.seller.email)]) : null,
      ]),
      el("Podmiot2", null, [
        el("DaneIdentyfikacyjne", null, [
          ...(buyerNip ? [el("NIP", null, buyerNip)] : eu ? [el("KodUE", null, d.buyer.vatId!.slice(0, 2).toUpperCase().replace("GR", "EL")), el("NrVatUE", null, d.buyer.vatId!.slice(2))] : [el("BrakID", null, "1")]),
          el("Nazwa", null, d.buyer.name),
        ]),
        ksefAddress(d.buyer),
        d.buyer.email ? el("DaneKontaktowe", null, [el("Email", null, d.buyer.email)]) : null,
        el("JST", null, "2"), el("GV", null, "2"),
      ]),
      el("Fa", null, [
        el("KodWaluty", null, d.currency),
        el("P_1", null, d.issueDate),
        el("P_2", null, d.number),
        ...KSEF_ORDER.filter((k) => sums.has(k)).map((k) => el(k, null, amt(sums.get(k)!.toString()))),
        el("P_15", null, amt(d.totals.gross)),
        el("Adnotacje", null, [
          el("P_16", null, "2"),
          el("P_17", null, d.kind.startsWith("SELF_BILLED") ? "1" : "2"),
          el("P_18", null, reverse ? "1" : "2"),
          el("P_18A", null, d.extra.splitPayment ? "1" : "2"),
          el("Zwolnienie", null, [el("P_19N", null, "1")]),
          el("NoweSrodkiTransportu", null, [el("P_22N", null, "1")]),
          el("P_23", null, "2"),
          el("PMarzy", null, [el("P_PMarzyN", null, "1")]),
        ]),
        el("RodzajFaktury", null, credit ? "KOR" : "VAT"),
        credit ? el("PrzyczynaKorekty", null, d.notes[0] ?? "Korekta") : null,
        credit ? el("TypKorekty", null, "3") : null,
        credit && d.preceding ? el("DaneFaKorygowanej", null, [el("DataWystFaKorygowanej", null, d.preceding.issueDate), el("NrFaKorygowanej", null, d.preceding.number), el("NrKSeFN", null, "1")]) : null,
        ...d.lines.map((l, i) => el("FaWiersz", null, [
          el("NrWierszaFa", null, String(i + 1)),
          el("P_7", null, l.name.slice(0, 512)),
          el("P_8A", null, l.unitCode === "KGM" ? "kg" : "szt."),
          el("P_8B", null, D(l.qty).toString()),
          el("P_9A", null, linePrice(l.qty, l.net).price),
          el("P_11", null, amt(l.net)),
          el("P_12", null, l.vatCategory === "AE" ? "oo" : l.vatCategory === "K" ? "0 WDT" : l.vatCategory === "E" ? "zw" : D(l.vatRate).toString()),
        ])),
        d.payment && !credit ? el("Platnosc", null, [
          d.dueDate ? el("TerminPlatnosci", null, [el("Termin", null, d.dueDate)]) : null,
          el("FormaPlatnosci", null, "6"),
          d.payment.iban ? el("RachunekBankowy", null, [el("NrRB", null, d.payment.iban.replace(/\s+/g, ""))]) : null,
        ]) : null,
      ]),
    ].filter(Boolean) as XNode[],
  };
  return toXml(root);
}

// ── FatturaPA 1.2 (Italy, SDI) ──────────────────────────────────────────────

const itVat = (v: string | null | undefined) => (v ?? "").replace(/^[A-Z]{2}/i, "");
const NATURA: Partial<Record<VatCategory, string>> = { AE: "N6.9", K: "N3.2", E: "N4", Z: "N3.5", O: "N2.2" };

function fpaParty(tag: string, p: EParty, seller: boolean): XNode {
  return el(tag, null, [
    el("DatiAnagrafici", null, [
      p.vatId ? el("IdFiscaleIVA", null, [el("IdPaese", null, p.vatId.slice(0, 2).toUpperCase()), el("IdCodice", null, itVat(p.vatId))]) : null,
      !p.vatId && p.taxId ? el("CodiceFiscale", null, p.taxId) : null,
      el("Anagrafica", null, [el("Denominazione", null, p.name)]),
      seller ? el("RegimeFiscale", null, "RF01") : null,
    ]),
    el("Sede", null, [el("Indirizzo", null, p.street ?? "-"), el("CAP", null, p.countryCode === "IT" ? (p.postalCode ?? "00000") : "00000"), el("Comune", null, p.city ?? "-"), el("Nazione", null, p.countryCode)]),
  ])!;
}

export function toFatturaPA(d: EDoc, progressivo: string): string {
  const credit = d.typeCode === "381" || d.typeCode === "261";
  const selfBilled = d.kind.startsWith("SELF_BILLED");
  const code = d.buyer.countryCode !== "IT" ? "XXXXXXX" : (d.extra.sdiCode ?? "0000000");
  const root: XNode = {
    tag: "p:FatturaElettronica",
    attrs: { versione: "FPR12", "xmlns:ds": "http://www.w3.org/2000/09/xmldsig#", "xmlns:p": "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" },
    children: [
      el("FatturaElettronicaHeader", null, [
        el("DatiTrasmissione", null, [
          el("IdTrasmittente", null, [el("IdPaese", null, (d.seller.vatId ?? "IT").slice(0, 2).toUpperCase()), el("IdCodice", null, itVat(d.seller.vatId ?? d.seller.taxId))]),
          el("ProgressivoInvio", null, progressivo),
          el("FormatoTrasmissione", null, "FPR12"),
          el("CodiceDestinatario", null, code),
          code === "0000000" && d.extra.pec ? el("PECDestinatario", null, d.extra.pec) : null,
        ]),
        fpaParty("CedentePrestatore", d.seller, true),
        fpaParty("CessionarioCommittente", d.buyer, false),
      ]),
      el("FatturaElettronicaBody", null, [
        el("DatiGenerali", null, [
          el("DatiGeneraliDocumento", null, [
            el("TipoDocumento", null, selfBilled ? "TD16" : credit ? "TD04" : "TD01"),
            el("Divisa", null, d.currency), el("Data", null, d.issueDate), el("Numero", null, d.number),
            el("ImportoTotaleDocumento", null, amt(d.totals.gross)),
            ...d.notes.slice(0, 3).map((n) => el("Causale", null, n.slice(0, 200))),
          ]),
          d.orderReference ? el("DatiOrdineAcquisto", null, [el("IdDocumento", null, d.orderReference)]) : null,
          d.preceding ? el("DatiFattureCollegate", null, [el("IdDocumento", null, d.preceding.number), el("Data", null, d.preceding.issueDate)]) : null,
        ]),
        el("DatiBeniServizi", null, [
          ...d.lines.map((l, i) => el("DettaglioLinee", null, [
            el("NumeroLinea", null, String(i + 1)),
            el("Descrizione", null, l.name.slice(0, 1000)),
            el("Quantita", null, D(l.qty).toFixed(2)),
            el("UnitaMisura", null, l.unitCode === "KGM" ? "kg" : "pz"),
            el("PrezzoUnitario", null, D(l.net).div(D(l.qty).isZero() ? 1 : l.qty).toFixed(8)),
            el("PrezzoTotale", null, amt(l.net)),
            el("AliquotaIVA", null, D(l.vatRate).toFixed(2)),
            NATURA[l.vatCategory] && D(l.vatRate).isZero() ? el("Natura", null, NATURA[l.vatCategory]!) : null,
          ])),
          ...d.taxes.map((t) => el("DatiRiepilogo", null, [
            el("AliquotaIVA", null, D(t.rate).toFixed(2)),
            NATURA[t.category] && D(t.rate).isZero() ? el("Natura", null, NATURA[t.category]!) : null,
            el("ImponibileImporto", null, amt(t.base)),
            el("Imposta", null, amt(t.vat)),
            D(t.rate).isZero() ? null : el("EsigibilitaIVA", null, "I"),
            t.exemptionText ? el("RiferimentoNormativo", null, t.exemptionText.slice(0, 100)) : null,
          ])),
        ]),
        d.payment && !credit ? el("DatiPagamento", null, [
          el("CondizioniPagamento", null, "TP02"),
          el("DettaglioPagamento", null, [
            el("ModalitaPagamento", null, "MP05"), el("DataScadenzaPagamento", null, d.dueDate), el("ImportoPagamento", null, amt(d.totals.payable)),
            d.payment.iban ? el("IBAN", null, d.payment.iban.replace(/\s+/g, "")) : null,
          ]),
        ]) : null,
      ]),
    ].filter(Boolean) as XNode[],
  };
  return toXml(root);
}

// ── Verifactu (Spain, AEAT) ─────────────────────────────────────────────────

const VF_NS = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const esNif = (v: string | null | undefined) => (v ?? "").replace(/^ES/i, "");

/** The record's fingerprint (huella): SHA-256 over the AEAT field string, upper-case hex. */
export function verifactuHuella(f: { nif: string; number: string; date: string; type: string; vat: string; gross: string; previous: string | null; at: string }) {
  const s = `IDEmisorFactura=${f.nif}&NumSerieFactura=${f.number}&FechaExpedicionFactura=${f.date}&TipoFactura=${f.type}&CuotaTotal=${f.vat}&ImporteTotal=${f.gross}&Huella=${f.previous ?? ""}&FechaHoraHusoGenRegistro=${f.at}`;
  return createHash("sha256").update(s, "utf8").digest("hex").toUpperCase();
}

export function toVerifactu(d: EDoc, at = new Date()): { xml: string; huella: string } {
  const credit = d.typeCode === "381" || d.typeCode === "261";
  const type = credit ? "R1" : "F1";
  const nif = esNif(d.seller.taxId ?? d.seller.vatId);
  const ts = at.toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const huella = verifactuHuella({ nif, number: d.number, date: dmy(d.issueDate), type, vat: amt(d.totals.vat), gross: amt(d.totals.gross), previous: d.extra.previousHash ?? null, at: ts });
  const n = (t: string) => `sum1:${t}`;
  const buyerEs = d.buyer.countryCode === "ES";
  const root: XNode = {
    tag: n("RegistroAlta"),
    attrs: { "xmlns:sum1": VF_NS },
    children: [
      el(n("IDVersion"), null, "1.0"),
      el(n("IDFactura"), null, [el(n("IDEmisorFactura"), null, nif), el(n("NumSerieFactura"), null, d.number), el(n("FechaExpedicionFactura"), null, dmy(d.issueDate))]),
      el(n("NombreRazonEmisor"), null, d.seller.name),
      el(n("TipoFactura"), null, type),
      credit ? el(n("TipoRectificativa"), null, "I") : null,
      credit && d.preceding ? el(n("FacturasRectificadas"), null, [el(n("IDFacturaRectificada"), null, [el(n("IDEmisorFactura"), null, nif), el(n("NumSerieFactura"), null, d.preceding.number), el(n("FechaExpedicionFactura"), null, d.preceding.issueDate ? dmy(d.preceding.issueDate) : null)])]) : null,
      el(n("DescripcionOperacion"), null, (d.notes[0] ?? "Venta de productos alimentarios").slice(0, 500)),
      el(n("Destinatarios"), null, [el(n("IDDestinatario"), null, [
        el(n("NombreRazon"), null, d.buyer.name),
        buyerEs ? el(n("NIF"), null, esNif(d.buyer.taxId ?? d.buyer.vatId)) : el(n("IDOtro"), null, [el(n("CodigoPais"), null, d.buyer.countryCode), el(n("IDType"), null, "02"), el(n("ID"), null, d.buyer.vatId ?? d.buyer.taxId ?? "-")]),
      ])]),
      el(n("Desglose"), null, d.taxes.map((t) => el(n("DetalleDesglose"), null, [
        el(n("ClaveRegimen"), null, "01"),
        t.category === "S" ? el(n("CalificacionOperacion"), null, "S1") : t.category === "AE" ? el(n("CalificacionOperacion"), null, "S2") : el(n("OperacionExenta"), null, t.category === "K" ? "E5" : "E1"),
        t.category === "S" ? el(n("TipoImpositivo"), null, D(t.rate).toFixed(2)) : null,
        el(n("BaseImponibleOimporteNoSujeto"), null, amt(t.base)),
        t.category === "S" ? el(n("CuotaRepercutida"), null, amt(t.vat)) : null,
      ]))),
      el(n("CuotaTotal"), null, amt(d.totals.vat)),
      el(n("ImporteTotal"), null, amt(d.totals.gross)),
      el(n("Encadenamiento"), null, d.extra.previousHash && d.extra.previousNumber
        ? [el(n("RegistroAnterior"), null, [el(n("IDEmisorFactura"), null, nif), el(n("NumSerieFactura"), null, d.extra.previousNumber), el(n("FechaExpedicionFactura"), null, d.extra.previousDate ? dmy(d.extra.previousDate) : null), el(n("Huella"), null, d.extra.previousHash)])]
        : [el(n("PrimerRegistro"), null, "S")]),
      el(n("SistemaInformatico"), null, [
        el(n("NombreRazon"), null, "FIRINGI"), el(n("NIF"), null, nif), el(n("NombreSistemaInformatico"), null, "FIRINGI"), el(n("IdSistemaInformatico"), null, "FI"),
        el(n("Version"), null, "1.0"), el(n("NumeroInstalacion"), null, "1"), el(n("TipoUsoPosibleSoloVerifactu"), null, "S"), el(n("TipoUsoPosibleMultiOT"), null, "S"), el(n("IndicadorMultiplesOT"), null, "N"),
      ]),
      el(n("FechaHoraHusoGenRegistro"), null, ts),
      el(n("TipoHuella"), null, "01"),
      el(n("Huella"), null, huella),
    ].filter(Boolean) as XNode[],
  };
  return { xml: toXml(root), huella };
}

/** The XML for a format (Factur-X: the CII part; the PDF wrapper is added by the sender). */
export function renderXml(format: EFormat, d: EDoc, opts: { progressivo?: string; at?: Date } = {}): { xml: string; huella?: string } {
  switch (format) {
    case "PEPPOL_BIS3": return { xml: toUbl(d, "PEPPOL_BIS3") };
    case "XRECHNUNG": return { xml: toUbl(d, "XRECHNUNG") };
    case "FACTURX": return { xml: toCii(d) };
    case "KSEF_FA3": return { xml: toKsef(d, opts.at) };
    case "FATTURAPA": return { xml: toFatturaPA(d, opts.progressivo ?? "00001") };
    case "VERIFACTU": return toVerifactu(d, opts.at);
  }
}

/** File name a format is delivered / archived under. */
export function xmlFileName(format: EFormat, number: string, sellerVat?: string | null) {
  const safe = number.replace(/[^\w.-]+/g, "_");
  if (format === "FATTURAPA") return `${(sellerVat ?? "IT00000000000").replace(/\s+/g, "")}_${safe.slice(-5).padStart(5, "0")}.xml`;
  if (format === "FACTURX") return "factur-x.xml";
  return `${safe}.xml`;
}
