/**
 * Food safety logbook report (Phase 69, @react-pdf/renderer) — what an inspector asks for: completion, every
 * temperature reading against its limits, checklists and cleaning, deliveries received, cooling, corrective actions,
 * missed checks and training. Portuguese with English second, like the other FIRINGI documents.
 */
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { reportData } from "@/server/haccp/service";

type R = Awaited<ReturnType<typeof reportData>>;
const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica", color: "#111827" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  muted: { color: "#6b7280" },
  kpis: { flexDirection: "row", gap: 8, marginTop: 10 },
  kpi: { flex: 1, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 4, padding: 6 },
  kpiV: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 2.5 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#9ca3af", paddingVertical: 2.5, fontFamily: "Helvetica-Bold" },
  bad: { color: "#b91c1c", fontFamily: "Helvetica-Bold" },
});
const c = (w: string) => ({ width: w, paddingRight: 4 });
const t = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-PT")} °C`);
const d = (x: Date) => x.toISOString().slice(0, 10);

function Table({ cols, rows }: { cols: [string, string][]; rows: (string | { v: string; bad?: boolean })[][] }) {
  return (
    <View>
      <View style={s.head} fixed>{cols.map(([label, w], i) => <Text key={i} style={c(w)}>{label}</Text>)}</View>
      {rows.length === 0 ? <Text style={[s.muted, { paddingVertical: 3 }]}>— sem registos / no entries —</Text> : rows.map((r, j) => (
        <View key={j} style={s.row} wrap={false}>{r.map((x, i) => typeof x === "string" ? <Text key={i} style={c(cols[i][1])}>{x}</Text> : <Text key={i} style={[c(cols[i][1]), x.bad ? s.bad : {}]}>{x.v}</Text>)}</View>
      ))}
    </View>
  );
}

function Report({ r }: { r: R }) {
  const okText = (ok: boolean) => ({ v: ok ? "OK" : "NÃO / NO", bad: !ok });
  const readings = r.units.flatMap((u) => u.readings.map((x) => [x.day, x.slot ?? "—", u.name, u.limit, { v: t(x.valueC), bad: !x.ok }, x.by ?? "—", x.corrective ?? ""]));
  const tasks = r.tasks.flatMap((k) => k.done.map((x) => [x.day, k.name, okText(x.ok), x.by ?? "—", x.corrective ?? ""]));
  const missed = r.days.flatMap((day) => day.missed.map((m) => [day.day, m.what, m.at ?? "—"]));
  return (
    <Document title={`Registos HACCP ${r.company.name} ${d(r.from)} – ${d(r.to)}`} author="FIRINGI">
      <Page size="A4" style={s.page} wrap>
        <Text style={s.h1}>Registos de segurança alimentar (HACCP)</Text>
        <Text style={s.muted}>Food safety logbook · {r.company.legalName}{r.company.taxId ? ` · NIF / VAT ${r.company.taxId}` : ""} · {d(r.from)} – {d(r.to)} · FIRINGI</Text>
        <View style={s.kpis}>
          <View style={s.kpi}><Text style={s.muted}>Cumprimento / Completion</Text><Text style={s.kpiV}>{r.pct}%</Text><Text style={s.muted}>{r.done} / {r.due}</Text></View>
          <View style={s.kpi}><Text style={s.muted}>Fora dos limites / Out of range</Text><Text style={s.kpiV}>{r.corrective.length}</Text></View>
          <View style={s.kpi}><Text style={s.muted}>Em falta / Missed</Text><Text style={s.kpiV}>{missed.length}</Text></View>
          <View style={s.kpi}><Text style={s.muted}>Receções / Deliveries</Text><Text style={s.kpiV}>{r.deliveries.length}</Text></View>
        </View>

        <Text style={s.h2}>Temperaturas / Temperatures</Text>
        <Table cols={[["Data / Date", "12%"], ["Hora / Time", "8%"], ["Equipamento / Equipment", "22%"], ["Limite / Limit", "13%"], ["Leitura / Reading", "12%"], ["Por / By", "13%"], ["Ação corretiva / Corrective action", "20%"]]} rows={readings} />

        <Text style={s.h2}>Listas de verificação e limpeza / Checklists & cleaning</Text>
        <Table cols={[["Data / Date", "12%"], ["Tarefa / Task", "33%"], ["Estado / Result", "12%"], ["Por / By", "15%"], ["Ação corretiva / Corrective action", "28%"]]} rows={tasks} />

        <Text style={s.h2}>Receção de mercadorias / Deliveries received</Text>
        <Table cols={[["Data / Date", "12%"], ["Fornecedor / Supplier", "20%"], ["Produto / Product", "18%"], ["Temp.", "9%"], ["Emb. / Pack", "8%"], ["Datas / Dates", "8%"], ["Estado / Result", "10%"], ["Ação corretiva / Corrective action", "15%"]]}
          rows={r.deliveries.map((x) => [x.day, x.supplier ?? "—", x.product ?? "—", t(x.valueC), x.results?.packagingOk ? "OK" : "✗", x.results?.datesOk ? "OK" : "✗", okText(x.ok), x.corrective ?? ""])} />

        <Text style={s.h2}>Arrefecimento / Cooling (≤ {r.rules.coolingTargetC} °C em / within {r.rules.coolingMaxMinutes} min)</Text>
        <Table cols={[["Data / Date", "12%"], ["Produto / Product", "28%"], ["Início / Start", "12%"], ["Fim / End", "12%"], ["Min.", "8%"], ["Estado / Result", "10%"], ["Ação corretiva / Corrective action", "18%"]]}
          rows={r.cooling.map((x) => [x.day, x.product ?? "—", t(x.startC), t(x.endC), String(x.minutes ?? "—"), okText(x.ok), x.corrective ?? ""])} />

        <Text style={s.h2}>Registos em falta / Missed checks</Text>
        <Table cols={[["Data / Date", "15%"], ["Registo / Check", "60%"], ["Hora / Time", "25%"]]} rows={missed} />

        {r.training.length > 0 && <>
          <Text style={s.h2}>Formação / Training</Text>
          <Table cols={[["Pessoa / Person", "25%"], ["Curso / Course", "35%"], ["N.º / No.", "12%"], ["Data / Date", "14%"], ["Válido até / Valid until", "14%"]]}
            rows={r.training.map((x) => [x.person, x.course, x.certificateNo ?? "—", x.issuedAt, { v: x.expiresAt ?? "—", bad: x.expired }])} />
        </>}
        <Text style={[s.muted, { marginTop: 14 }]}>Gerado pela FIRINGI em {r.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC. Generated by FIRINGI from the business&apos;s own records.</Text>
        <Text style={s.muted} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

export async function renderHaccpPdf(r: R) {
  return renderToBuffer(<Report r={r} />);
}
