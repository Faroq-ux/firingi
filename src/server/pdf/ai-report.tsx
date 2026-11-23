/** Phase 66 — an AI report as a PDF (English, FIRINGI back office): summary, KPIs against the period before, tables. */
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReportData } from "@/server/ai/centre/reports";
import { registerFonts } from "./documents";

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "DejaVu", color: "#1f2937" },
  b: { fontFamily: "DejaVu", fontWeight: "bold" },
  th: { fontFamily: "DejaVu", fontWeight: "bold", backgroundColor: "#ecfeff", paddingVertical: 4, paddingHorizontal: 3 },
  td: { paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderColor: "#e5e7eb" },
  row: { flexDirection: "row" },
});
const money = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

function ReportDoc({ d, summary, byClaude, created }: { d: ReportData; summary: string; byClaude: boolean; created: string }) {
  return (
    <Document title={`${d.title} ${d.from} – ${d.to}`} author="FIRINGI" language="en">
      <Page size="A4" style={s.page} wrap>
        <View style={[s.row, { justifyContent: "space-between", marginBottom: 14 }]}>
          <View><Text style={[s.b, { fontSize: 18, color: "#0e7490" }]}>FIRINGI</Text><Text style={{ color: "#6b7280" }}>AI Centre</Text></View>
          <View style={{ alignItems: "flex-end" }}><Text style={[s.b, { fontSize: 14 }]}>{d.title}</Text><Text>{d.from} – {d.to}</Text><Text style={{ color: "#6b7280" }}>Made {created}</Text></View>
        </View>
        <Text style={[s.b, { marginBottom: 4 }]}>Summary{byClaude ? " (written by Claude from the numbers below)" : ""}</Text>
        <Text style={{ marginBottom: 12, lineHeight: 1.4 }}>{summary}</Text>
        <View style={[s.row, { flexWrap: "wrap", marginBottom: 12 }]}>
          {d.kpis.map((k) => (
            <View key={k.label} style={{ width: "33%", padding: 6, borderWidth: 0.5, borderColor: "#e5e7eb" }}>
              <Text style={{ color: "#6b7280", fontSize: 8 }}>{k.label}</Text>
              <Text style={[s.b, { fontSize: 12 }]}>{k.fmt === "money" ? money(k.value) : k.fmt === "percent" ? `${k.value}%` : k.value.toLocaleString("en")}</Text>
              {k.prev != null && <Text style={{ color: "#6b7280", fontSize: 7.5 }}>before: {k.fmt === "money" ? money(k.prev) : k.prev.toLocaleString("en")}</Text>}
            </View>
          ))}
        </View>
        {byClaude && d.highlights.length > 0 && <View style={{ marginBottom: 12 }}>{d.highlights.map((h, i) => <Text key={i}>• {h}</Text>)}</View>}
        {d.tables.filter((t) => t.rows.length).map((t) => (
          <View key={t.title} style={{ marginBottom: 12 }} wrap>
            <Text style={[s.b, { marginBottom: 3 }]}>{t.title}</Text>
            <View style={s.row}>{t.columns.map((c, i) => <Text key={c} style={[s.th, { width: i === 0 ? `${100 - (t.columns.length - 1) * (60 / Math.max(1, t.columns.length - 1))}%` : `${60 / Math.max(1, t.columns.length - 1)}%` }]}>{c}</Text>)}</View>
            {t.rows.slice(0, 60).map((r, j) => (
              <View key={j} style={s.row} wrap={false}>{r.map((v, i) => <Text key={i} style={[s.td, { width: i === 0 ? `${100 - (t.columns.length - 1) * (60 / Math.max(1, t.columns.length - 1))}%` : `${60 / Math.max(1, t.columns.length - 1)}%` }]}>{String(v)}</Text>)}</View>
            ))}
          </View>
        ))}
        <Text style={{ marginTop: 8, color: "#6b7280", fontSize: 7.5 }}>AI suggests; people decide. Nothing in this report changed orders, prices or stock.</Text>
      </Page>
    </Document>
  );
}

export async function renderAiReportPdf(d: ReportData, summary: string, byClaude: boolean, created: Date) {
  registerFonts();
  return renderToBuffer(<ReportDoc d={d} summary={summary} byClaude={byClaude} created={created.toISOString().slice(0, 16).replace("T", " ")} />);
}
