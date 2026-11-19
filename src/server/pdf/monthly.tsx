/**
 * Phase 46 — the monthly summary PDF that goes with the month's XML to a company's accountant, in the company's
 * document language. Two sections that are never added together: the invoices FIRINGI issued to the company (its
 * purchases and services) and the company's own invoices to FIRINGI (its sales — self-billed by FIRINGI in its name,
 * or sent by itself). Each with totals by VAT rate and in total, per currency.
 */
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { docTexts, numberLocale } from "@/server/einvoice/doc-i18n";
import { registerFonts } from "./documents";

export type MonthlyRow = { side: "IN" | "OUT" | "TILL"; date: string; number: string; kind: "INVOICE" | "INVOICE_RECEIPT" | "CREDIT_NOTE" | "SELF_BILLED" | "SELF_BILLED_CREDIT" | "TILL_DAY"; currency: string; net: number; vat: number; gross: number; rates: { rate: number; base: number; vat: number }[] };
export type MonthlyPdfData = { language: string; period: string; company: { name: string; taxId: string; vatId: string | null }; issuer: string; rows: MonthlyRow[]; withXml: boolean };

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 8.5, fontFamily: "DejaVu", color: "#1f2937" },
  b: { fontFamily: "DejaVu", fontWeight: "bold" },
  th: { fontFamily: "DejaVu", fontWeight: "bold", backgroundColor: "#f3f4f6", paddingVertical: 4, paddingHorizontal: 3 },
  td: { paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderColor: "#e5e7eb" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
});

function MonthlyDoc({ d }: { d: MonthlyPdfData }) {
  const t = docTexts(d.language);
  const loc = numberLocale(d.language);
  const money = (v: number, c: string) => `${v.toLocaleString(loc, { minimumFractionDigits: c === "ISK" ? 0 : 2, maximumFractionDigits: c === "ISK" ? 0 : 2 })} ${c === "EUR" ? "€" : c}`;
  const sign = (k: MonthlyRow["kind"]) => (k === "CREDIT_NOTE" || k === "SELF_BILLED_CREDIT" ? -1 : 1);
  const title = (k: MonthlyRow["kind"]) => ({ INVOICE: t.title_INVOICE, INVOICE_RECEIPT: t.title_INVOICE_RECEIPT, CREDIT_NOTE: t.title_CREDIT_NOTE, SELF_BILLED: t.title_SELF_BILLED, SELF_BILLED_CREDIT: t.title_SELF_BILLED_CREDIT, TILL_DAY: t.tillDay })[k];
  const cols = [14, 26, 24, 12, 12, 12];
  return (
    <Document title={`${t.monthlySummary} ${d.period}`} author="FIRINGI" language={d.language}>
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View><Text style={[s.b, { fontSize: 18, color: "#1e3a8a" }]}>FIRINGI</Text><Text style={{ color: "#6b7280" }}>{d.issuer}</Text></View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.b, { fontSize: 14 }]}>{t.monthlySummary}</Text>
            <Text>{t.period}: {d.period}</Text>
          </View>
        </View>
        <View style={{ marginTop: 10 }}>
          <Text style={s.b}>{d.company.name}</Text>
          <Text>{t.taxId}: {d.company.taxId}{d.company.vatId ? `   ${t.vatId}: ${d.company.vatId}` : ""}</Text>
          <Text>{t.count}: {d.rows.length}</Text>
        </View>
        {(["IN", "OUT", "TILL"] as const).map((side) => {
          const list = d.rows.filter((r) => r.side === side);
          if (!list.length && (d.rows.length || side === "TILL")) return null;
          const currencies = [...new Set(list.map((r) => r.currency))];
          return (
            <View key={side} style={{ marginTop: 14 }}>
              <Text style={[s.b, { fontSize: 10.5, color: "#1e3a8a", marginBottom: 4 }]}>{side === "IN" ? t.fromFiringi : side === "OUT" ? t.toFiringi : t.tillSales}</Text>
              <View style={s.row}>
                {[t.date, t.documents, "", t.totalNet, t.vat, t.total].map((h, i) => <Text key={i} style={[s.th, { width: `${cols[i]}%`, textAlign: i >= 3 ? "right" : "left" }]}>{h}</Text>)}
              </View>
              {!list.length && <Text style={[s.td, { color: "#6b7280" }]}>{t.noDocs}</Text>}
              {list.map((r, i) => (
                <View key={i} style={s.row} wrap={false}>
                  <Text style={[s.td, { width: `${cols[0]}%` }]}>{r.date}</Text>
                  <Text style={[s.td, { width: `${cols[1]}%` }]}>{r.kind === "TILL_DAY" ? `${r.number} ${t.receipts}` : r.number}</Text>
                  <Text style={[s.td, { width: `${cols[2]}%` }]}>{title(r.kind)}</Text>
                  <Text style={[s.td, { width: `${cols[3]}%`, textAlign: "right" }]}>{money(sign(r.kind) * r.net, r.currency)}</Text>
                  <Text style={[s.td, { width: `${cols[4]}%`, textAlign: "right" }]}>{money(sign(r.kind) * r.vat, r.currency)}</Text>
                  <Text style={[s.td, { width: `${cols[5]}%`, textAlign: "right" }]}>{money(sign(r.kind) * r.gross, r.currency)}</Text>
                </View>
              ))}
              {currencies.map((c) => {
                const rows = list.filter((r) => r.currency === c);
                const byRate = new Map<number, { base: number; vat: number }>();
                for (const r of rows) for (const x of r.rates) { const cur = byRate.get(x.rate) ?? { base: 0, vat: 0 }; byRate.set(x.rate, { base: cur.base + sign(r.kind) * x.base, vat: cur.vat + sign(r.kind) * x.vat }); }
                const sum = (k: "net" | "vat" | "gross") => rows.reduce((a, r) => a + sign(r.kind) * r[k], 0);
                return (
                  <View key={c} style={{ marginTop: 8, marginLeft: "45%" }} wrap={false}>
                    <Text style={[s.b, { marginBottom: 3 }]}>{t.totalsByVat}{currencies.length > 1 ? ` (${c})` : ""}</Text>
                    {[...byRate].sort((a, b) => b[0] - a[0]).map(([rate, v]) => <View key={rate} style={s.between}><Text>{rate < 0 ? t.rateAsInvoice : `${rate}%`} — {t.base} {money(v.base, c)}</Text><Text>{t.vat} {money(v.vat, c)}</Text></View>)}
                    <View style={[s.between, { marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderColor: "#111827" }]}><Text style={s.b}>{t.monthTotal}</Text><Text style={s.b}>{money(sum("gross"), c)}</Text></View>
                    <View style={s.between}><Text>{t.totalNet}</Text><Text>{money(sum("net"), c)}</Text></View>
                    <View style={s.between}><Text>{t.vat}</Text><Text>{money(sum("vat"), c)}</Text></View>
                  </View>
                );
              })}
            </View>
          );
        })}
        {d.withXml && <Text style={{ marginTop: 14, color: "#1e3a8a", fontSize: 7.5 }}>{t.attachedXml}</Text>}
      </Page>
    </Document>
  );
}

export const renderMonthlyPdf = (d: MonthlyPdfData) => { registerFonts(); return renderToBuffer(<MonthlyDoc d={d} />); };
