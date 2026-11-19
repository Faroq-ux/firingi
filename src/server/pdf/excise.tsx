/** Monthly excise report (Phase 43, @react-pdf/renderer). Portuguese with English second, like the other FIRINGI documents. */
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { exciseReport } from "@/server/excise/service";

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 8.5, fontFamily: "Helvetica", color: "#111827" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  muted: { color: "#6b7280" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 3 },
  th: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  bold: { fontFamily: "Helvetica-Bold" },
});
type R = Awaited<ReturnType<typeof exciseReport>>;
const n = (x: number, dp = 0) => (x ? x.toFixed(dp).replace(".", ",") : "—");
const eur = (x: number) => `${x.toFixed(2).replace(".", ",")} €`;
const MODE: Record<string, string> = { PAID: "No preço / In price", ADDED: "Acrescido / Added" };
const W = [2.2, 0.7, 1.4, 0.8, 1, 1.2, 0.9, 0.8, 1.1, 1.1, 0.7];

export async function renderExciseReport(r: R) {
  const cell = (i: number, t: string | number, right = false) => <Text style={{ flex: W[i], textAlign: right ? "right" : "left", paddingRight: 4 }}>{String(t)}</Text>;
  const doc = (
    <Document title={`Excise ${r.month}`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>Relatório de impostos especiais de consumo · Excise report</Text>
        <Text style={s.muted}>{r.company}{r.taxId ? ` · NIF ${r.taxId}` : ""} · {r.month} · gerado / generated {new Date().toISOString().slice(0, 16).replace("T", " ")}</Text>
        <Text style={s.h2}>Resumo · Summary</Text>
        <View style={s.th}>{["Categoria / Category", "País", "Imposto / Duty", "Unid.", "Litros", "L álcool puro", "Unidades", "kg", "Acrescido", "No preço", "Enc."].map((h, i) => cell(i, h, i >= 3))}</View>
        {r.rows.map((x) => (
          <View key={`${x.code}-${x.country}-${x.mode}`} style={s.row} wrap={false}>
            {cell(0, x.category)}{cell(1, x.country)}{cell(2, MODE[x.mode] ?? x.mode)}{cell(3, x.units, true)}{cell(4, n(x.litres, 2), true)}{cell(5, n(x.lpa, 3), true)}{cell(6, n(x.sticks), true)}{cell(7, n(x.kg, 3), true)}{cell(8, eur(x.dutyAdded), true)}{cell(9, eur(x.dutyIncluded), true)}{cell(10, x.orders, true)}
          </View>
        ))}
        {!r.rows.length && <Text style={[s.muted, { marginTop: 6 }]}>Sem entregas este mês · Nothing delivered this month.</Text>}
        <View style={[s.row, s.bold]}>{cell(0, "Total")}{cell(1, "")}{cell(2, "")}{cell(3, "")}{cell(4, n(r.totals.litres, 2), true)}{cell(5, n(r.totals.lpa, 3), true)}{cell(6, n(r.totals.sticks), true)}{cell(7, "")}{cell(8, eur(r.totals.dutyAdded), true)}{cell(9, eur(r.totals.dutyIncluded), true)}{cell(10, "")}</View>
        <Text style={s.h2}>Detalhe · Detail</Text>
        <View style={s.th}>{["Data / Date", "Enc. / Order", "Cliente / Customer", "Categoria", "SKU", "Qtd", "L a.p.", "Imposto / Duty", "Documento / e-DA"].map((h, i) => <Text key={h} style={{ flex: [1, 1.3, 2, 1.5, 1.2, 0.5, 0.8, 0.9, 1.6][i], textAlign: i >= 5 && i <= 7 ? "right" : "left", paddingRight: 4 }}>{h}</Text>)}</View>
        {r.detail.map((x, k) => (
          <View key={k} style={s.row} wrap={false}>
            {[x.date ? x.date.toISOString().slice(0, 10) : "", x.order, x.customer, x.category, x.sku, String(x.qty), n(x.lpa, 3), eur(x.duty), x.doc ?? "—"].map((t, i) => <Text key={i} style={{ flex: [1, 1.3, 2, 1.5, 1.2, 0.5, 0.8, 0.9, 1.6][i], textAlign: i >= 5 && i <= 7 ? "right" : "left", paddingRight: 4 }}>{t}</Text>)}
          </View>
        ))}
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
