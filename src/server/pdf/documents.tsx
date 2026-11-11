/**
 * PDF documents (server-side, @react-pdf/renderer): FIRINGI invoices / credit notes and
 * vendor billing statements. Invoices and credit notes are always in the language of the
 * issuing country (FIRINGI Portugal → Portuguese only). Billing statements are Portuguese
 * with English as the second language for every vendor.
 */
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

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
const qtyFmt = (v: string | number) => Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 3 });

type Party = { name?: string; taxId?: string; vatNumber?: string | null; address?: string | null; email?: string; iban?: string | null; country?: string };

export type InvoicePdfData = {
  docType: "INVOICE" | "INVOICE_RECEIPT" | "CREDIT_NOTE";
  fullNumber: string; issuedAt: Date; dueAt: Date | null; atcud: string | null; hash: string | null; certified: boolean;
  orderNumber: string | null; originalNumber: string | null; reason?: string | null; taxRegime: string;
  issuer: Party; recipient: Party;
  lines: { description: string; qty: string; unitPriceNet: string; discountNet: string; taxRate: string; lineNet: string }[];
  taxSummary: { taxRate: string; base: string; vat: string }[];
  netTotal: string; vatTotal: string; grossTotal: string; taxLabel: string;
};

/** Invoice labels per issuing country. Add a country here when FIRINGI issues from it. */
const INVOICE_LABELS = {
  PT: {
    title: { INVOICE: "Fatura", INVOICE_RECEIPT: "Fatura-Recibo", CREDIT_NOTE: "Nota de Crédito" },
    date: "Data", due: "Vencimento", seller: "Vendedor", customer: "Cliente", vat: "NIF-IVA", nif: "NIF",
    order: "Encomenda", original: "Documento de origem", reason: "Motivo", reverseCharge: "IVA — autoliquidação",
    description: "Descrição", qty: "Qtd.", unitPrice: "Preço unit.", discount: "Desconto", totalExcl: "Total s/", summary: "Resumo de",
    notFiscal: "DOCUMENTO NÃO FISCAL — ambiente de testes, não emitido por programa certificado pela AT",
    certified: "Processado por programa certificado", notCertified: "Processado por FIRINGI (ambiente de testes, programa não certificado)",
  },
};
type InvoiceLabels = (typeof INVOICE_LABELS)["PT"];
const invoiceLabels = (country?: string): InvoiceLabels => INVOICE_LABELS[(country ?? "PT") as keyof typeof INVOICE_LABELS] ?? INVOICE_LABELS.PT;

function PartyBox({ title, p, nif = "NIF", vat = "VAT" }: { title: string; p: Party; nif?: string; vat?: string }) {
  return (
    <View style={s.box}>
      <Text style={[s.muted, { marginBottom: 3 }]}>{title}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.name}</Text>
      {p.address && <Text>{p.address}</Text>}
      <Text>{nif}: {p.taxId}{p.vatNumber ? `   ${vat}: ${p.vatNumber}` : ""}</Text>
      {p.email && <Text>{p.email}</Text>}
    </View>
  );
}

function InvoiceDoc({ d }: { d: InvoicePdfData }) {
  const cols = [44, 8, 12, 10, 10, 16]; // widths % (sum 100)
  const L = invoiceLabels(d.issuer.country);
  return (
    <Document title={d.fullNumber} author="FIRINGI">
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View><Text style={s.brand}>FIRINGI</Text><Text style={s.muted}>WHOLESALE MADE SIMPLE</Text></View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{L.title[d.docType]}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.fullNumber}</Text>
            <Text>{L.date}: {d.issuedAt.toISOString().slice(0, 10)}</Text>
            {d.dueAt && d.docType !== "CREDIT_NOTE" && <Text>{L.due}: {d.dueAt.toISOString().slice(0, 10)}</Text>}
            {d.atcud && <Text>ATCUD: {d.atcud}</Text>}
          </View>
        </View>
        {!d.certified && <Text style={s.warn}>{L.notFiscal}</Text>}
        <View style={[s.between, { marginTop: 12 }]}>
          <PartyBox title={L.seller} p={d.issuer} nif={L.nif} vat={L.vat} />
          <PartyBox title={L.customer} p={d.recipient} nif={L.nif} vat={L.vat} />
        </View>
        <View style={{ marginTop: 8 }}>
          {d.orderNumber && <Text>{L.order}: {d.orderNumber}</Text>}
          {d.originalNumber && <Text>{L.original}: {d.originalNumber}</Text>}
          {d.reason && <Text>{L.reason}: {d.reason}</Text>}
          {d.taxRegime === "INTRA_EU_REVERSE_CHARGE" && <Text>{L.reverseCharge}</Text>}
        </View>
        <View style={{ marginTop: 10 }}>
          <View style={s.row}>
            {[L.description, L.qty, L.unitPrice, L.discount, d.taxLabel, `${L.totalExcl} ${d.taxLabel}`].map((h, i) => (
              <Text key={h} style={[s.th, { width: `${cols[i]}%`, textAlign: i ? "right" : "left" }]}>{h}</Text>
            ))}
          </View>
          {d.lines.map((l, k) => (
            <View key={k} style={s.row} wrap={false}>
              <Text style={[s.td, { width: `${cols[0]}%` }]}>{l.description}</Text>
              <Text style={[s.td, { width: `${cols[1]}%`, textAlign: "right" }]}>{qtyFmt(l.qty)}</Text>
              <Text style={[s.td, { width: `${cols[2]}%`, textAlign: "right" }]}>{eur(l.unitPriceNet)}</Text>
              <Text style={[s.td, { width: `${cols[3]}%`, textAlign: "right" }]}>{Number(l.discountNet) ? eur(l.discountNet) : "—"}</Text>
              <Text style={[s.td, { width: `${cols[4]}%`, textAlign: "right" }]}>{Number(l.taxRate)}%</Text>
              <Text style={[s.td, { width: `${cols[5]}%`, textAlign: "right" }]}>{eur(l.lineNet)}</Text>
            </View>
          ))}
        </View>
        <View style={[s.between, { marginTop: 12 }]}>
          <View style={{ width: "48%" }}>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>{L.summary} {d.taxLabel}</Text>
            {d.taxSummary.map((t) => <Text key={t.taxRate}>{Number(t.taxRate)}% — base {eur(t.base)} — {d.taxLabel} {eur(t.vat)}</Text>)}
            {d.issuer.iban && d.docType !== "CREDIT_NOTE" && <Text style={{ marginTop: 6 }}>IBAN: {d.issuer.iban}</Text>}
          </View>
          <View style={{ width: "40%" }}>
            <View style={s.between}><Text>{L.totalExcl} {d.taxLabel}</Text><Text>{eur(d.netTotal)}</Text></View>
            <View style={s.between}><Text>{d.taxLabel}</Text><Text>{eur(d.vatTotal)}</Text></View>
            <View style={[s.between, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderColor: "#111827" }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>Total</Text><Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{eur(d.grossTotal)}</Text>
            </View>
          </View>
        </View>
        <Text style={s.footer} fixed>
          {d.hash ? `${d.hash.slice(0, 1)}${d.hash.slice(10, 11)}${d.hash.slice(20, 21)}${d.hash.slice(30, 31)} - ` : ""}
          {d.certified ? L.certified : L.notCertified} · {d.issuer.name} · NIF {d.issuer.taxId}
        </Text>
      </Page>
    </Document>
  );
}

export type StatementPdfData = {
  number: string; createdAt: Date; isCredit: boolean; orderNumber: string; vendor: Party; firingi: Party; taxRegime: string;
  lines: { sku: string; description: string; qty: number; unitCostNet: string; lineNet: string; taxRate: string; vat: string }[];
  expectedNet: string; expectedVat: string; expectedGross: string; commissionTotal: string;
};

function StatementDoc({ d }: { d: StatementPdfData }) {
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

export const renderInvoicePdf = (d: InvoicePdfData) => renderToBuffer(<InvoiceDoc d={d} />);
export const renderStatementPdf = (d: StatementPdfData) => renderToBuffer(<StatementDoc d={d} />);
export const renderPurchaseOrderPdf = (d: PurchaseOrderPdfData) => renderToBuffer(<PurchaseOrderDoc d={d} />);
