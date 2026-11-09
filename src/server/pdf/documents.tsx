/**
 * PDF documents (server-side, @react-pdf/renderer): FIRINGI invoices / credit notes and
 * vendor billing statements. Bilingual labels (PT / EN) as the business is Portuguese.
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

const TITLE = { INVOICE: "Fatura / Invoice", INVOICE_RECEIPT: "Fatura-Recibo / Invoice-Receipt", CREDIT_NOTE: "Nota de Crédito / Credit Note" };

function PartyBox({ title, p }: { title: string; p: Party }) {
  return (
    <View style={s.box}>
      <Text style={[s.muted, { marginBottom: 3 }]}>{title}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.name}</Text>
      {p.address && <Text>{p.address}</Text>}
      <Text>NIF: {p.taxId}{p.vatNumber ? `   VAT: ${p.vatNumber}` : ""}</Text>
      {p.email && <Text>{p.email}</Text>}
    </View>
  );
}

function InvoiceDoc({ d }: { d: InvoicePdfData }) {
  const cols = [44, 8, 12, 10, 10, 16]; // widths % (sum 100)
  return (
    <Document title={d.fullNumber} author="FIRINGI">
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View><Text style={s.brand}>FIRINGI</Text><Text style={s.muted}>WHOLESALE MADE SIMPLE</Text></View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{TITLE[d.docType]}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.fullNumber}</Text>
            <Text>Data / Date: {d.issuedAt.toISOString().slice(0, 10)}</Text>
            {d.dueAt && d.docType !== "CREDIT_NOTE" && <Text>Vencimento / Due: {d.dueAt.toISOString().slice(0, 10)}</Text>}
            {d.atcud && <Text>ATCUD: {d.atcud}</Text>}
          </View>
        </View>
        {!d.certified && <Text style={s.warn}>DOCUMENTO NÃO FISCAL — NOT A FISCAL DOCUMENT (test environment, not issued by AT-certified software)</Text>}
        <View style={[s.between, { marginTop: 12 }]}>
          <PartyBox title="Vendedor / Seller" p={d.issuer} />
          <PartyBox title="Cliente / Customer" p={d.recipient} />
        </View>
        <View style={{ marginTop: 8 }}>
          {d.orderNumber && <Text>Encomenda / Order: {d.orderNumber}</Text>}
          {d.originalNumber && <Text>Documento de origem / Original document: {d.originalNumber}</Text>}
          {d.reason && <Text>Motivo / Reason: {d.reason}</Text>}
          {d.taxRegime === "INTRA_EU_REVERSE_CHARGE" && <Text>IVA — autoliquidação / VAT reverse charge</Text>}
        </View>
        <View style={{ marginTop: 10 }}>
          <View style={s.row}>
            {["Descrição / Description", "Qtd.", "Preço unit.", "Desconto", d.taxLabel, "Total s/ " + d.taxLabel].map((h, i) => (
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
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>Resumo de {d.taxLabel} / {d.taxLabel} summary</Text>
            {d.taxSummary.map((t) => <Text key={t.taxRate}>{Number(t.taxRate)}% — base {eur(t.base)} — {d.taxLabel} {eur(t.vat)}</Text>)}
            {d.issuer.iban && d.docType !== "CREDIT_NOTE" && <Text style={{ marginTop: 6 }}>IBAN: {d.issuer.iban}</Text>}
          </View>
          <View style={{ width: "40%" }}>
            <View style={s.between}><Text>Total s/ {d.taxLabel}</Text><Text>{eur(d.netTotal)}</Text></View>
            <View style={s.between}><Text>{d.taxLabel}</Text><Text>{eur(d.vatTotal)}</Text></View>
            <View style={[s.between, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderColor: "#111827" }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>Total</Text><Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{eur(d.grossTotal)}</Text>
            </View>
          </View>
        </View>
        <Text style={s.footer} fixed>
          {d.hash ? `${d.hash.slice(0, 1)}${d.hash.slice(10, 11)}${d.hash.slice(20, 21)}${d.hash.slice(30, 31)} - ` : ""}
          {d.certified ? "Processado por programa certificado" : "Processado por FIRINGI (ambiente de testes, programa não certificado)"} · {d.issuer.name} · NIF {d.issuer.taxId}
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
          <View><Text style={s.brand}>FIRINGI</Text><Text style={s.muted}>Billing statement / Extrato de faturação</Text></View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{d.isCredit ? "Credit statement" : "Billing statement"}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.number}</Text>
            <Text>Order / Encomenda: {d.orderNumber}</Text>
            <Text>Date: {d.createdAt.toISOString().slice(0, 10)}</Text>
          </View>
        </View>
        <Text style={[s.warn, { backgroundColor: "#e0e7ff", color: "#1e3a8a" }]}>
          {d.isCredit ? "Please issue a CREDIT NOTE to FIRINGI for exactly these amounts and upload it." : "Please issue an INVOICE to FIRINGI for exactly these amounts and upload it in the FIRINGI portal."}
        </Text>
        <View style={[s.between, { marginTop: 12 }]}>
          <PartyBox title="Invoice from (you) / De" p={d.vendor} />
          <PartyBox title="Invoice to / Para" p={d.firingi} />
        </View>
        {d.taxRegime === "INTRA_EU_REVERSE_CHARGE" && <Text style={{ marginTop: 6 }}>Intra-EU supply — VAT reverse charge (Art. 138 / 196 Directive 2006/112/EC). Invoice WITHOUT VAT and state the reverse charge.</Text>}
        <View style={{ marginTop: 10 }}>
          <View style={s.row}>
            {[["SKU", 14], ["Description", 40], ["Qty", 8], ["Unit cost", 12], ["VAT", 8], ["Net", 18]].map(([h, w]) => (
              <Text key={h} style={[s.th, { width: `${w}%`, textAlign: h === "SKU" || h === "Description" ? "left" : "right" }]}>{h}</Text>
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
          <View style={s.between}><Text>Net</Text><Text>{eur(d.expectedNet)}</Text></View>
          <View style={s.between}><Text>VAT</Text><Text>{eur(d.expectedVat)}</Text></View>
          <View style={[s.between, { borderTopWidth: 1, marginTop: 3, paddingTop: 3 }]}><Text style={{ fontFamily: "Helvetica-Bold" }}>Total</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{eur(d.expectedGross)}</Text></View>
          {!d.isCredit && <Text style={[s.muted, { marginTop: 6 }]}>FIRINGI commission already deducted: {eur(d.commissionTotal)}</Text>}
        </View>
      </Page>
    </Document>
  );
}

export const renderInvoicePdf = (d: InvoicePdfData) => renderToBuffer(<InvoiceDoc d={d} />);
export const renderStatementPdf = (d: StatementPdfData) => renderToBuffer(<StatementDoc d={d} />);
