/**
 * Phase 46 — document wording in the 25 languages (invoices, credit notes, self-billed invoices), the
 * EU / per-country legal mentions, and the translation of FIRINGI's fixed line texts. Stored invoice lines keep
 * their original (legal-record) text; documents are printed / sent in the document's language from it.
 */
import { pickLocalized } from "@/i18n/config";
import { DOC_TEXTS } from "./doc-i18n.data";

export const DOC_EN = {
  title_INVOICE: "Invoice",
  title_INVOICE_RECEIPT: "Invoice-receipt",
  title_CREDIT_NOTE: "Credit note",
  title_SELF_BILLED: "Self-billed invoice",
  title_SELF_BILLED_CREDIT: "Self-billed credit note",
  date: "Date",
  due: "Due date",
  seller: "Seller",
  customer: "Customer",
  supplier: "Supplier",
  vatId: "VAT no.",
  taxId: "Tax ID",
  order: "Order",
  branch: "Branch",
  costCentre: "Cost centre",
  po: "Your reference (PO)",
  original: "Corrects document",
  reason: "Reason",
  description: "Description",
  qty: "Qty",
  unitPrice: "Unit price",
  discount: "Discount",
  vat: "VAT",
  netAmount: "Net amount",
  vatSummary: "VAT summary",
  base: "base",
  totalNet: "Total excl. VAT",
  total: "Total",
  amountDue: "Amount due",
  paymentRef: "Payment reference",
  eurEquivalent: "EUR equivalent",
  notFiscal: "NOT A FISCAL DOCUMENT — test environment, not issued by certified software",
  certified: "Issued by certified software",
  notCertified: "Issued by FIRINGI (test environment, not certified software)",
  deliveryFiringi: "Delivery (FIRINGI)",
  deliverySupplier: "Delivery (supplier's flat rate)",
  excise: "Excise duty",
  includesExcise: "incl. excise duty",
  deposit: "Deposit",
  loyalty: "Loyalty points discount",
  ads: "FIRINGI advertising",
  adsTopUp: "prepaid balance top-up",
  earlyPay: "Early payout",
  invoices: "invoice(s)",
  reverseCharge: "Reverse charge — VAT to be accounted for by the customer (Art. 196 Directive 2006/112/EC)",
  intraEuSupply: "Exempt intra-Community supply (Art. 138 Directive 2006/112/EC)",
  selfBilling: "Self-billing — issued by the customer in the name and on behalf of the supplier (Art. 224 and 226(10a) Directive 2006/112/EC)",
  eInvoice: "Electronic invoice",
  sentVia: "Sent electronically",
  networkRef: "Network reference",
  agreement: "Self-billing agreement",
  monthlySummary: "Monthly summary",
  period: "Period",
  documents: "Documents",
  count: "Number of documents",
  totalsByVat: "Totals by VAT rate",
  monthTotal: "Total for the month",
  attachedXml: "The documents are attached as XML (e-invoices) for your accounting software.",
  packIntro: "Your monthly invoice pack from FIRINGI",
  fromFiringi: "Invoices from FIRINGI to you (purchases and services)",
  toFiringi: "Your invoices to FIRINGI (sales, incl. self-billing)",
  rateAsInvoice: "rate as on the invoice",
  noDocs: "No documents",
  tillSales: "Your till sales (sales to your guests at the counter)",
  tillDay: "Till sales of the day",
  receipts: "receipts",
} as const;

export type DocKey = keyof typeof DOC_EN;
export type DocTexts = Record<DocKey, string>;

/** Texts for a language (missing keys fall back to English). */
export function docTexts(lang: string | null | undefined): DocTexts {
  const t = (DOC_TEXTS as Record<string, Partial<DocTexts>>)[lang ?? "en"] ?? {};
  return { ...DOC_EN, ...t };
}

/** Locale for numbers / dates of a document language. */
export const numberLocale = (lang: string) => (lang === "nb" ? "nb-NO" : lang === "pt-PT" ? "pt-PT" : lang);

// ── legal mentions per issuing country ──────────────────────────────────────

/**
 * Wording the issuing country's law asks for on top of the EU mentions (always in that country's form; the
 * EU mentions — reverse charge, intra-EU supply, self-billing — are printed in the document's language).
 */
export function countryLegalTexts(issuerCountry: string, x: { splitPayment: boolean; verifactu: boolean; lang: string; selfBilled: boolean }): string[] {
  const out: string[] = [];
  if (issuerCountry === "PL" && x.splitPayment) out.push("mechanizm podzielonej płatności");
  if (issuerCountry === "PL" && x.selfBilled) out.push("samofakturowanie");
  if (issuerCountry === "FR") out.push("Pénalités de retard : 3 fois le taux d'intérêt légal. Indemnité forfaitaire pour frais de recouvrement : 40 €. Pas d'escompte pour paiement anticipé.");
  if (issuerCountry === "ES" && x.verifactu) out.push("VERI*FACTU — Factura verificable en la sede electrónica de la AEAT");
  if (issuerCountry === "DE" && x.selfBilled) out.push("Gutschrift");
  if (issuerCountry === "IT" && x.selfBilled) out.push("Autofattura");
  if (issuerCountry === "PT" && x.selfBilled) out.push("Autofaturação");
  return out;
}

// ── FIRINGI's fixed line texts → the document language ──────────────────────

type LineSrc = { description: string; orderLine?: { productName: unknown; packagingName: unknown; sku: string } | null };

/**
 * A stored line text in the document's language. Goods lines are rebuilt from the order line's product name
 * (in that language when the catalogue has it, else English); FIRINGI's own fixed texts are translated; anything
 * else is kept as written.
 */
export function localizeLine(l: LineSrc, lang: string): string {
  const t = docTexts(lang);
  const d = l.description;
  const base = lang.split("-")[0];
  const pickLang = base === "pt" ? "pt" : lang;
  if (d === "Entrega (FIRINGI)") return t.deliveryFiringi;
  if (d === "Entrega (taxa fixa do fornecedor)" || d === "Entrega (taxa fixa)") return t.deliverySupplier;
  if (d.startsWith("Imposto especial de consumo")) return d.replace("Imposto especial de consumo", t.excise);
  if (d.startsWith("Depósito: ")) return d.replace("Depósito", t.deposit);
  if (d.startsWith("Desconto por pontos de fidelização")) return d.replace("Desconto por pontos de fidelização", t.loyalty);
  if (d === "Publicidade FIRINGI — carregamento de saldo pré-pago") return `${t.ads} — ${t.adsTopUp}`;
  if (d.startsWith("Publicidade FIRINGI")) return d.replace("Publicidade FIRINGI", t.ads);
  const ep = /^Antecipação de pagamento (\S+) — (\d+) fatura\(s\)$/.exec(d);
  if (ep) return `${t.earlyPay} ${ep[1]} — ${ep[2]} ${t.invoices}`;
  if (l.orderLine && base !== "pt") {
    // "<product> — <packaging> (SKU x)<weight>" → same shape in the language
    const m = /^(.*) — (.*) \(SKU ([^)]+)\)(.*)$/.exec(d);
    if (m) {
      const name = pickLocalized(l.orderLine.productName, pickLang) || m[1];
      const pack = pickLocalized(l.orderLine.packagingName, pickLang) || m[2];
      return `${name} — ${pack} (SKU ${m[3]})${m[4]}`;
    }
  }
  return d;
}
