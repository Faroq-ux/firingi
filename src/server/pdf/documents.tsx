/**
 * PDF documents (server-side, @react-pdf/renderer): FIRINGI invoices / credit notes and
 * vendor billing statements. Invoices and credit notes are always in the language of the
 * issuing country (FIRINGI Portugal → Portuguese only). Billing statements are Portuguese
 * with English as the second language for every vendor.
 */
import React from "react";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { docTexts, numberLocale } from "@/server/einvoice/doc-i18n";

/** Phase 46: DejaVu Sans has every letter of the 25 languages (ł, ř, ő, Greek, Cyrillic …); Helvetica has not. */
let fonts = false;
export function registerFonts() {
  if (fonts) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({ family: "DejaVu", fonts: [{ src: path.join(dir, "DejaVuSans.ttf") }, { src: path.join(dir, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }] });
  Font.registerHyphenationCallback((w) => [w]);
  fonts = true;
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#1f2937" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  brand: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#1e3a8a" },
  muted: { color: "#6b7280" },
  box: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 4, padding: 8, width: "48%" },
  th: { fontFamily: "Helvetica-Bold", backgroundColor: "#f3f4f6", paddingVertical: 4, paddingHorizontal: 3 },
  td: { paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderColor: "#e5e7eb" },
  warn: { marginTop: 6, padding: 6, backgroundColor: "#fef3c7", color: "#92400e", fontFamily: "Helvetica-Bold", textAlign: "center" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 7, color: "#6b7280" },
});
const eur = (v: string | number) => `${Number(v).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
/** Phase 45: amounts in another currency carry its ISO code (Helvetica has no "zł", "Kč" …). */
const inCode = (code: string) => (v: string | number) => (code === "EUR" ? eur(v) : `${Number(v).toLocaleString("pt-PT", { minimumFractionDigits: code === "ISK" ? 0 : 2, maximumFractionDigits: code === "ISK" ? 0 : 2 })} ${code}`);
const qtyFmt = (v: string | number) => Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 3 });

type Party = { name?: string; taxId?: string; vatNumber?: string | null; address?: string | null; email?: string; iban?: string | null; country?: string };

export type InvoicePdfData = {
  docType: "INVOICE" | "INVOICE_RECEIPT" | "CREDIT_NOTE";
  fullNumber: string; issuedAt: Date; dueAt: Date | null; atcud: string | null; hash: string | null; certified: boolean;
  orderNumber: string | null; originalNumber: string | null; reason?: string | null; taxRegime: string;
  /** Phase 27: the buyer's branch, cost centre and PO reference */
  branch?: string | null; costCentre?: string | null; poReference?: string | null;
  issuer: Party; recipient: Party;
  lines: { description: string; description2?: string | null; qty: string; unitPriceNet: string; discountNet: string; taxRate: string; lineNet: string; exciseNet?: string }[];
  taxSummary: { taxRate: string; base: string; vat: string }[];
  netTotal: string; vatTotal: string; grossTotal: string; taxLabel: string;
  /** Phase 46: document language, optional second language, legal mentions, self-billing, e-invoice reference */
  language?: string; secondLanguage?: string | null; legalTexts?: string[]; selfBilled?: boolean; agreement?: string | null;
  einvoice?: { format: string; networkRef: string | null; status: string } | null;
  /** Phase 45: the document's currency (lines and totals above are in it) and the EUR equivalent at the reference rate */
  currency?: { code: string; rate: string; date: string | null; eur: { net: string; vat: string; gross: string } | null } | null;
};

const B = { fontFamily: "DejaVu", fontWeight: "bold" as const };

function PartyBox({ title, p, nif = "NIF", vat = "VAT" }: { title: string; p: Party; nif?: string; vat?: string }) {
  return (
    <View style={s.box}>
      <Text style={[s.muted, { marginBottom: 3 }]}>{title}</Text>
      <Text style={B}>{p.name}</Text>
      {p.address && <Text>{p.address}</Text>}
      <Text>{nif}: {p.taxId}{p.vatNumber ? `   ${vat}: ${p.vatNumber}` : ""}</Text>
      {p.email && <Text>{p.email}</Text>}
    </View>
  );
}

/**
 * Phase 46: invoices, credit notes and self-billed invoices in the document's language (and an optional second
 * language under each label / line), with the EU and country legal mentions and the e-invoice reference.
 */
function InvoiceDoc({ d }: { d: InvoicePdfData }) {
  const cols = [44, 8, 12, 10, 10, 16]; // widths % (sum 100)
  const lang = d.language ?? (d.issuer.country === "PT" || !d.issuer.country ? "pt-PT" : "en");
  const t = docTexts(lang);
  const t2 = d.secondLanguage ? docTexts(d.secondLanguage) : null;
  const L = (k: keyof typeof t) => (t2 && t2[k] !== t[k] ? `${t[k]} / ${t2[k]}` : t[k]);
  const loc = numberLocale(lang);
  const code = d.currency?.code ?? "EUR";
  const money = (c: string) => (v: string | number) => `${Number(v).toLocaleString(loc, { minimumFractionDigits: c === "ISK" ? 0 : 2, maximumFractionDigits: c === "ISK" ? 0 : 2 })} ${c === "EUR" ? "€" : c}`;
  const eur = money(code);
  const realEur = money("EUR");
  const qty = (v: string | number) => Number(v).toLocaleString(loc, { maximumFractionDigits: 3 });
  const vatL = d.issuer.country === "PT" && lang === "pt-PT" ? d.taxLabel : t.vat;
  const title = d.selfBilled ? (d.docType === "CREDIT_NOTE" ? L("title_SELF_BILLED_CREDIT") : L("title_SELF_BILLED")) : L(`title_${d.docType}` as keyof typeof t);
  const ptCert = d.issuer.country === "PT" || !d.issuer.country;
  const mentions = [
    ...(d.taxRegime === "INTRA_EU_REVERSE_CHARGE" ? [t.reverseCharge, ...(t2 ? [t2.reverseCharge] : [])] : []),
    ...(d.taxRegime === "INTRA_EU_SUPPLY" ? [t.intraEuSupply, ...(t2 ? [t2.intraEuSupply] : [])] : []),
    ...(d.selfBilled ? [t.selfBilling, ...(t2 ? [t2.selfBilling] : []), ...(d.agreement ? [`${L("agreement")}: ${d.agreement}`] : [])] : []),
    ...(d.legalTexts ?? []),
  ];
  return (
    <Document title={d.fullNumber} author="FIRINGI" language={lang}>
      <Page size="A4" style={[s.page, { fontFamily: "DejaVu", fontSize: 8.5 }]}>
        <View style={s.between}>
          <View><Text style={[s.brand, B]}>FIRINGI</Text><Text style={s.muted}>WHOLESALE MADE SIMPLE</Text></View>
          <View style={{ alignItems: "flex-end", maxWidth: "60%" }}>
            <Text style={[s.h1, B, { textAlign: "right" }]}>{title}</Text>
            <Text style={B}>{d.fullNumber}</Text>
            <Text>{L("date")}: {d.issuedAt.toISOString().slice(0, 10)}</Text>
            {d.dueAt && d.docType !== "CREDIT_NOTE" && <Text>{L("due")}: {d.dueAt.toISOString().slice(0, 10)}</Text>}
            {d.atcud && <Text>ATCUD: {d.atcud}</Text>}
          </View>
        </View>
        {!d.certified && ptCert && !d.selfBilled && <Text style={[s.warn, B]}>{t.notFiscal}</Text>}
        <View style={[s.between, { marginTop: 12 }]}>
          <PartyBox title={d.selfBilled ? L("supplier") : L("seller")} p={d.issuer} nif={L("taxId")} vat={L("vatId")} />
          <PartyBox title={L("customer")} p={d.recipient} nif={L("taxId")} vat={L("vatId")} />
        </View>
        <View style={{ marginTop: 8 }}>
          {d.orderNumber && <Text>{L("order")}: {d.orderNumber}</Text>}
          {d.poReference && <Text>{L("po")}: {d.poReference}</Text>}
          {(d.branch || d.costCentre) && <Text>{[d.branch ? `${L("branch")}: ${d.branch}` : null, d.costCentre ? `${L("costCentre")}: ${d.costCentre}` : null].filter(Boolean).join("   ")}</Text>}
          {d.originalNumber && <Text>{L("original")}: {d.originalNumber}</Text>}
          {d.reason && <Text>{L("reason")}: {d.reason}</Text>}
        </View>
        <View style={{ marginTop: 10 }}>
          <View style={s.row}>
            {[L("description"), L("qty"), L("unitPrice"), L("discount"), vatL, L("netAmount")].map((h, i) => (
              <Text key={`${h}-${i}`} style={[s.th, B, { width: `${cols[i]}%`, textAlign: i ? "right" : "left" }]}>{h}</Text>
            ))}
          </View>
          {d.lines.map((l, k) => (
            <View key={k} style={s.row} wrap={false}>
              <Text style={[s.td, { width: `${cols[0]}%` }]}>
                {l.description}
                {l.description2 && l.description2 !== l.description ? `\n${l.description2}` : ""}
                {Number(l.exciseNet ?? 0) > 0 && !l.description.startsWith(t.excise) ? `\n${t.includesExcise}: ${eur(l.exciseNet!)}` : ""}
              </Text>
              <Text style={[s.td, { width: `${cols[1]}%`, textAlign: "right" }]}>{qty(l.qty)}</Text>
              <Text style={[s.td, { width: `${cols[2]}%`, textAlign: "right" }]}>{eur(l.unitPriceNet)}</Text>
              <Text style={[s.td, { width: `${cols[3]}%`, textAlign: "right" }]}>{Number(l.discountNet) ? eur(l.discountNet) : "—"}</Text>
              <Text style={[s.td, { width: `${cols[4]}%`, textAlign: "right" }]}>{Number(l.taxRate)}%</Text>
              <Text style={[s.td, { width: `${cols[5]}%`, textAlign: "right" }]}>{eur(l.lineNet)}</Text>
            </View>
          ))}
        </View>
        <View style={[s.between, { marginTop: 12 }]}>
          <View style={{ width: "52%" }}>
            <Text style={[B, { marginBottom: 3 }]}>{L("vatSummary")}</Text>
            {d.taxSummary.map((x) => <Text key={x.taxRate}>{Number(x.taxRate)}% — {t.base} {eur(x.base)} — {vatL} {eur(x.vat)}</Text>)}
            {d.issuer.iban && d.docType !== "CREDIT_NOTE" && !d.selfBilled && <Text style={{ marginTop: 6 }}>IBAN: {d.issuer.iban}</Text>}
            {d.issuer.iban && d.docType !== "CREDIT_NOTE" && !d.selfBilled && <Text>{L("paymentRef")}: {d.fullNumber}</Text>}
          </View>
          <View style={{ width: "40%" }}>
            <View style={s.between}><Text>{L("totalNet")}</Text><Text>{eur(d.netTotal)}</Text></View>
            <View style={s.between}><Text>{vatL}</Text><Text>{eur(d.vatTotal)}</Text></View>
            <View style={[s.between, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderColor: "#111827" }]}>
              <Text style={[B, { fontSize: 11 }]}>{L("total")}</Text><Text style={[B, { fontSize: 11 }]}>{eur(d.grossTotal)}</Text>
            </View>
            {d.currency?.eur && (
              <View style={{ marginTop: 6, paddingTop: 4, borderTopWidth: 0.5, borderColor: "#e5e7eb" }}>
                <Text style={s.muted}>{L("eurEquivalent")} — 1 EUR = {Number(d.currency.rate).toLocaleString(loc, { maximumFractionDigits: 6 })} {d.currency.code}{d.currency.date ? ` (ECB ${d.currency.date})` : ""}</Text>
                <View style={s.between}><Text>{L("totalNet")}</Text><Text>{realEur(d.currency.eur.net)}</Text></View>
                <View style={s.between}><Text>{vatL}</Text><Text>{realEur(d.currency.eur.vat)}</Text></View>
                <View style={s.between}><Text>{L("total")}</Text><Text>{realEur(d.currency.eur.gross)}</Text></View>
              </View>
            )}
          </View>
        </View>
        {mentions.length > 0 && (
          <View style={{ marginTop: 10, padding: 6, borderWidth: 0.5, borderColor: "#e5e7eb", borderRadius: 3 }}>
            {mentions.map((m, i) => <Text key={i} style={{ fontSize: 7.5 }}>{m}</Text>)}
          </View>
        )}
        {d.einvoice && (
          <Text style={{ marginTop: 6, fontSize: 7.5, color: "#1e3a8a" }}>
            {L("eInvoice")} — {L("sentVia")}: {d.einvoice.format}{d.einvoice.networkRef ? ` · ${L("networkRef")}: ${d.einvoice.networkRef}` : ""}
          </Text>
        )}
        <Text style={s.footer} fixed>
          {d.hash ? `${d.hash.slice(0, 1)}${d.hash.slice(10, 11)}${d.hash.slice(20, 21)}${d.hash.slice(30, 31)} - ` : ""}
          {ptCert && !d.selfBilled ? `${d.certified ? t.certified : t.notCertified} · ` : ""}{d.issuer.name} · {L("taxId")} {d.issuer.taxId}
        </Text>
      </Page>
    </Document>
  );
}

export type StatementPdfData = {
  number: string; createdAt: Date; isCredit: boolean; orderNumber: string; vendor: Party; firingi: Party; taxRegime: string;
  lines: { sku: string; description: string; qty: number; unitCostNet: string; lineNet: string; taxRate: string; vat: string }[];
  expectedNet: string; expectedVat: string; expectedGross: string; commissionTotal: string;
  /** Phase 45: the supplier's currency (amounts above are in it) */
  currencyCode?: string;
};

function StatementDoc({ d }: { d: StatementPdfData }) {
  const eur = inCode(d.currencyCode ?? "EUR");
  return (
    <Document title={d.number} author="FIRINGI">
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View><Text style={s.brand}>FIRINGI</Text><Text style={s.muted}>WHOLESALE MADE SIMPLE</Text></View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{d.isCredit ? "Extrato de crédito / Credit statement" : "Extrato de faturação / Billing statement"}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.number}</Text>
            <Text>Encomenda / Order: {d.orderNumber}</Text>
            <Text>Data / Date: {d.createdAt.toISOString().slice(0, 10)}</Text>
          </View>
        </View>
        <Text style={[s.warn, { backgroundColor: "#e0e7ff", color: "#1e3a8a" }]}>
          {d.isCredit
            ? "Emita uma NOTA DE CRÉDITO à FIRINGI com exatamente estes valores e carregue-a no portal FIRINGI. / Please issue a CREDIT NOTE to FIRINGI for exactly these amounts and upload it."
            : "Emita uma FATURA à FIRINGI com exatamente estes valores e carregue-a no portal FIRINGI. / Please issue an INVOICE to FIRINGI for exactly these amounts and upload it in the FIRINGI portal."}
        </Text>
        <View style={[s.between, { marginTop: 12 }]}>
          <PartyBox title="De (o seu negócio) / Invoice from (you)" p={d.vendor} vat="NIF-IVA / VAT" />
          <PartyBox title="Para / Invoice to" p={d.firingi} vat="NIF-IVA / VAT" />
        </View>
        {d.taxRegime === "INTRA_EU_REVERSE_CHARGE" && <Text style={{ marginTop: 6 }}>Fornecimento intracomunitário — autoliquidação (art. 138.º / 196.º Diretiva 2006/112/CE): fature SEM IVA e indique a autoliquidação. / Intra-EU supply — VAT reverse charge: invoice WITHOUT VAT and state the reverse charge.</Text>}
        <View style={{ marginTop: 10 }}>
          <View style={s.row}>
            {[["SKU", 14], ["Descrição / Description", 40], ["Qtd.", 8], ["Custo unit.", 12], ["IVA", 8], ["Base", 18]].map(([h, w]) => (
              <Text key={h} style={[s.th, { width: `${w}%`, textAlign: Number(w) === 14 || Number(w) === 40 ? "left" : "right" }]}>{h}</Text>
            ))}
          </View>
          {d.lines.map((l, k) => (
            <View key={k} style={s.row} wrap={false}>
              <Text style={[s.td, { width: "14%" }]}>{l.sku}</Text>
              <Text style={[s.td, { width: "40%" }]}>{l.description}</Text>
              <Text style={[s.td, { width: "8%", textAlign: "right" }]}>{l.qty}</Text>
              <Text style={[s.td, { width: "12%", textAlign: "right" }]}>{eur(l.unitCostNet)}</Text>
              <Text style={[s.td, { width: "8%", textAlign: "right" }]}>{Number(l.taxRate)}%</Text>
              <Text style={[s.td, { width: "18%", textAlign: "right" }]}>{eur(l.lineNet)}</Text>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 12, marginLeft: "55%" }}>
          <View style={s.between}><Text>Base / Net</Text><Text>{eur(d.expectedNet)}</Text></View>
          <View style={s.between}><Text>IVA / VAT</Text><Text>{eur(d.expectedVat)}</Text></View>
          <View style={[s.between, { borderTopWidth: 1, marginTop: 3, paddingTop: 3 }]}><Text style={{ fontFamily: "Helvetica-Bold" }}>Total</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{eur(d.expectedGross)}</Text></View>
          {!d.isCredit && <Text style={[s.muted, { marginTop: 6 }]}>Comissão FIRINGI já deduzida / commission already deducted: {eur(d.commissionTotal)}</Text>}
        </View>
      </Page>
    </Document>
  );
}


export type PurchaseOrderPdfData = {
  number: string; date: Date; expectedOn: Date | null; notes: string | null; deliverTo: string; total: string;
  buyer: Party; supplier: Party;
  lines: { description: string; sku: string | null; qty: number; unitCost: string; total: string }[];
};

/** A supplier's purchase order to its own (outside) supplier — Portuguese, English second. Prices net of VAT. */
function PurchaseOrderDoc({ d }: { d: PurchaseOrderPdfData }) {
  return (
    <Document title={d.number} author={d.buyer.name ?? ""}>
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View><Text style={[s.brand, { fontSize: 16 }]}>{d.buyer.name}</Text>{d.buyer.vatNumber ? <Text style={s.muted}>NIF-IVA / VAT {d.buyer.vatNumber}</Text> : null}{d.buyer.email ? <Text style={s.muted}>{d.buyer.email}</Text> : null}</View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>Nota de encomenda / Purchase order</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.number}</Text>
            <Text>Data / Date: {d.date.toISOString().slice(0, 10)}</Text>
            {d.expectedOn ? <Text>Entrega prevista / Expected: {d.expectedOn.toISOString().slice(0, 10)}</Text> : null}
          </View>
        </View>
        <View style={[s.between, { marginTop: 14 }]}>
          <PartyBox title="Fornecedor / Supplier" p={d.supplier} vat="NIF-IVA / VAT" />
          <View style={s.box}><Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>Entregar em / Deliver to</Text><Text>{d.deliverTo}</Text></View>
        </View>
        <View style={{ marginTop: 12 }}>
          <View style={s.row}>
            {[["Ref.", 14], ["Descrição / Description", 46], ["Qtd. / Qty", 10], ["Preço unit. / Unit price", 15], ["Total", 15]].map(([h, w]) => (
              <Text key={h} style={[s.th, { width: `${w}%`, textAlign: Number(w) === 14 || Number(w) === 46 ? "left" : "right" }]}>{h}</Text>
            ))}
          </View>
          {d.lines.map((l, k) => (
            <View key={k} style={s.row} wrap={false}>
              <Text style={[s.td, { width: "14%" }]}>{l.sku ?? ""}</Text>
              <Text style={[s.td, { width: "46%" }]}>{l.description}</Text>
              <Text style={[s.td, { width: "10%", textAlign: "right" }]}>{qtyFmt(l.qty)}</Text>
              <Text style={[s.td, { width: "15%", textAlign: "right" }]}>{eur(l.unitCost)}</Text>
              <Text style={[s.td, { width: "15%", textAlign: "right" }]}>{eur(l.total)}</Text>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 12, marginLeft: "55%" }}>
          <View style={[s.between, { borderTopWidth: 1, paddingTop: 3 }]}><Text style={{ fontFamily: "Helvetica-Bold" }}>Total (s/ IVA / excl. VAT)</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{eur(d.total)}</Text></View>
        </View>
        {d.notes ? <Text style={{ marginTop: 14 }}>Notas / Notes: {d.notes}</Text> : null}
        <Text style={s.footer}>Por favor indique o lote e a data de validade de cada produto na guia de remessa. / Please state the lot number and best-before date of every product on the delivery note.</Text>
      </Page>
    </Document>
  );
}

export const renderInvoicePdf = (d: InvoicePdfData) => { registerFonts(); return renderToBuffer(<InvoiceDoc d={d} />); };
export const renderStatementPdf = (d: StatementPdfData) => { registerFonts(); return renderToBuffer(<StatementDoc d={d} />); };
export const renderPurchaseOrderPdf = (d: PurchaseOrderPdfData) => { registerFonts(); return renderToBuffer(<PurchaseOrderDoc d={d} />); };
