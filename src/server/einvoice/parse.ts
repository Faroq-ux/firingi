/**
 * Phase 46 — reading a received e-invoice (UBL Invoice / CreditNote, CII, KSeF FA) into the fields FIRINGI
 * needs to match it to a supplier statement. Unknown or broken XML gives null (the document is kept for review).
 */
import { XMLParser } from "fast-xml-parser";

export type ParsedInvoice = {
  format: "UBL" | "CII" | "KSEF";
  credit: boolean;
  number: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  seller: { name: string | null; vatId: string | null; taxId: string | null; peppolId: string | null };
  buyer: { name: string | null; vatId: string | null; peppolId: string | null };
  /** the FIRINGI statement / order it refers to (buyer reference, order reference) */
  references: string[];
  lines: { name: string; sku: string | null; qty: number; net: number; rate: number }[];
  net: number;
  vat: number;
  gross: number;
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, trimValues: true });

type N = Record<string, unknown> | undefined;
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return txt((v as Record<string, unknown>)["#text"]);
  const s = String(v).trim();
  return s || null;
};
const num = (v: unknown) => { const t = txt(v); return t ? Number(t) : 0; };
const at = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const ymd = (s: string | null) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);

function ublParty(p: unknown) {
  const party = at(p, "Party") as N;
  const ep = at(party, "EndpointID");
  const scheme = ep && typeof ep === "object" ? (ep as Record<string, string>)["@schemeID"] : null;
  const epId = txt(ep);
  return {
    name: txt(at(party, "PartyLegalEntity", "RegistrationName")) ?? txt(at(party, "PartyName", "Name")),
    vatId: txt(at(arr(at(party, "PartyTaxScheme") as N)[0], "CompanyID")),
    taxId: txt(at(party, "PartyLegalEntity", "CompanyID")),
    peppolId: epId && scheme && scheme !== "EM" ? `${scheme}:${epId}` : null,
  };
}

function fromUbl(root: Record<string, unknown>, credit: boolean): ParsedInvoice {
  const lines = arr((credit ? root.CreditNoteLine : root.InvoiceLine) as N | N[]).map((l) => ({
    name: txt(at(l, "Item", "Name")) ?? "",
    sku: txt(at(l, "Item", "SellersItemIdentification", "ID")),
    qty: num(at(l, credit ? "CreditedQuantity" : "InvoicedQuantity")),
    net: num(at(l, "LineExtensionAmount")),
    rate: num(at(l, "Item", "ClassifiedTaxCategory", "Percent")),
  }));
  const taxTotal = arr(root.TaxTotal as N | N[]).find((t) => {
    const a = at(t, "TaxAmount");
    return !(a && typeof a === "object" && (a as Record<string, string>)["@currencyID"] === "EUR" && txt(root.TaxCurrencyCode) === "EUR" && txt(root.DocumentCurrencyCode) !== "EUR");
  });
  const seller = ublParty(root.AccountingSupplierParty);
  const buyer = ublParty(root.AccountingCustomerParty);
  return {
    format: "UBL", credit,
    number: txt(root.ID) ?? "",
    issueDate: txt(root.IssueDate),
    dueDate: txt(root.DueDate) ?? txt(at(arr(root.PaymentMeans as N | N[])[0], "PaymentDueDate")),
    currency: txt(root.DocumentCurrencyCode) ?? "EUR",
    seller, buyer: { name: buyer.name, vatId: buyer.vatId, peppolId: buyer.peppolId },
    references: [txt(root.BuyerReference), txt(at(root, "OrderReference", "ID")), ...arr(root.Note as unknown[]).map(txt)].filter((x): x is string => !!x),
    lines,
    net: num(at(root, "LegalMonetaryTotal", "TaxExclusiveAmount")),
    vat: num(at(taxTotal, "TaxAmount")),
    gross: num(at(root, "LegalMonetaryTotal", "TaxInclusiveAmount")),
  };
}

function fromCii(root: Record<string, unknown>): ParsedInvoice {
  const doc = root.ExchangedDocument as N;
  const tx = root.SupplyChainTradeTransaction as N;
  const agr = at(tx, "ApplicableHeaderTradeAgreement") as N;
  const set = at(tx, "ApplicableHeaderTradeSettlement") as N;
  const sum = at(set, "SpecifiedTradeSettlementHeaderMonetarySummation") as N;
  const party = (p: unknown) => ({
    name: txt(at(p, "Name")),
    vatId: txt(arr(at(p, "SpecifiedTaxRegistration") as N | N[]).map((r) => at(r, "ID")).find((x) => x && typeof x === "object" && (x as Record<string, string>)["@schemeID"] === "VA")),
    taxId: txt(at(p, "SpecifiedLegalOrganization", "ID")),
    peppolId: null,
  });
  const type = txt(at(doc, "TypeCode"));
  const vatTotals = arr(at(sum, "TaxTotalAmount") as unknown[]);
  const cur = txt(at(set, "InvoiceCurrencyCode")) ?? "EUR";
  const vatNode = vatTotals.find((v) => !v || typeof v !== "object" || (v as Record<string, string>)["@currencyID"] === cur) ?? vatTotals[0];
  const s = party(at(agr, "SellerTradeParty"));
  const b = party(at(agr, "BuyerTradeParty"));
  return {
    format: "CII", credit: type === "381" || type === "261",
    number: txt(at(doc, "ID")) ?? "",
    issueDate: ymd(txt(at(doc, "IssueDateTime", "DateTimeString"))),
    dueDate: ymd(txt(at(set, "SpecifiedTradePaymentTerms", "DueDateDateTime", "DateTimeString"))),
    currency: cur,
    seller: s, buyer: { name: b.name, vatId: b.vatId, peppolId: null },
    references: [txt(at(agr, "BuyerReference")), txt(at(agr, "BuyerOrderReferencedDocument", "IssuerAssignedID")), ...arr(at(doc, "IncludedNote") as unknown[]).map((n) => txt(at(n, "Content")))].filter((x): x is string => !!x),
    lines: arr(at(tx, "IncludedSupplyChainTradeLineItem") as N | N[]).map((l) => ({
      name: txt(at(l, "SpecifiedTradeProduct", "Name")) ?? "",
      sku: txt(at(l, "SpecifiedTradeProduct", "SellerAssignedID")),
      qty: num(at(l, "SpecifiedLineTradeDelivery", "BilledQuantity")),
      net: num(at(l, "SpecifiedLineTradeSettlement", "SpecifiedTradeSettlementLineMonetarySummation", "LineTotalAmount")),
      rate: num(at(l, "SpecifiedLineTradeSettlement", "ApplicableTradeTax", "RateApplicablePercent")),
    })),
    net: num(at(sum, "TaxBasisTotalAmount")),
    vat: num(vatNode),
    gross: num(at(sum, "GrandTotalAmount")),
  };
}

function fromKsef(root: Record<string, unknown>): ParsedInvoice {
  const fa = root.Fa as N;
  const p1 = root.Podmiot1 as N;
  const p2 = root.Podmiot2 as N;
  const nets = ["P_13_1", "P_13_2", "P_13_3", "P_13_6_1", "P_13_6_2", "P_13_7", "P_13_10"].reduce((a, k) => a + num(at(fa, k)), 0);
  const vats = ["P_14_1", "P_14_2", "P_14_3"].reduce((a, k) => a + num(at(fa, k)), 0);
  const nip1 = txt(at(p1, "DaneIdentyfikacyjne", "NIP"));
  return {
    format: "KSEF", credit: txt(at(fa, "RodzajFaktury")) === "KOR",
    number: txt(at(fa, "P_2")) ?? "",
    issueDate: txt(at(fa, "P_1")),
    dueDate: txt(at(fa, "Platnosc", "TerminPlatnosci", "Termin")),
    currency: txt(at(fa, "KodWaluty")) ?? "PLN",
    seller: { name: txt(at(p1, "DaneIdentyfikacyjne", "Nazwa")), vatId: nip1 ? `PL${nip1}` : null, taxId: nip1, peppolId: null },
    buyer: { name: txt(at(p2, "DaneIdentyfikacyjne", "Nazwa")), vatId: txt(at(p2, "DaneIdentyfikacyjne", "NIP")), peppolId: null },
    references: [txt(at(fa, "WZ")), txt(at(fa, "DodatkowyOpis", "Wartosc"))].filter((x): x is string => !!x),
    lines: arr(at(fa, "FaWiersz") as N | N[]).map((l) => ({ name: txt(at(l, "P_7")) ?? "", sku: null, qty: num(at(l, "P_8B")), net: num(at(l, "P_11")), rate: num(at(l, "P_12")) })),
    net: Math.round(nets * 100) / 100,
    vat: Math.round(vats * 100) / 100,
    gross: num(at(fa, "P_15")),
  };
}

export function parseEInvoice(xml: string): ParsedInvoice | null {
  let doc: Record<string, unknown>;
  try { doc = parser.parse(xml) as Record<string, unknown>; } catch { return null; }
  if (doc.Invoice) return fromUbl(doc.Invoice as Record<string, unknown>, false);
  if (doc.CreditNote) return fromUbl(doc.CreditNote as Record<string, unknown>, true);
  if (doc.CrossIndustryInvoice) return fromCii(doc.CrossIndustryInvoice as Record<string, unknown>);
  if (doc.Faktura) return fromKsef(doc.Faktura as Record<string, unknown>);
  return null;
}
