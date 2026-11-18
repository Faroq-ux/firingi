/**
 * Cold-chain documents (Phase 42, @react-pdf/renderer): the temperature certificate of a delivery and the monthly
 * HACCP report. Portuguese with English second, like the other FIRINGI documents. No prices.
 */
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  muted: { color: "#6b7280" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 3 },
  th: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  between: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  box: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 4, padding: 8, flex: 1 },
  out: { color: "#b91c1c", fontFamily: "Helvetica-Bold" },
  warn: { color: "#b45309" },
});
const c1 = (n: number) => `${n.toFixed(1).replace(".", ",")} °C`;
const dt = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—");
const STAGE: Record<string, string> = { DISPATCH: "Expedição / Dispatch", LOADING: "Carga / Loading", HANDOVER: "Entrega / Handover", RECEIPT: "Receção / Receipt", LOGGER: "Registador / Logger" };
const STATUS: Record<string, string> = { OK: "OK", WARN: "Tolerância / Tolerance", OUT: "FORA / OUT" };
const DECISION: Record<string, string> = { NOTED: "Registado / Noted", ACCEPTED: "Aceite / Accepted", REFUSED: "Recusado / Refused", BLOCKED: "Bloqueado / Blocked" };

export type Certificate = {
  number: string; deliveredAt: Date | null; supplier: string; customer: string; address: string; vehicle: string | null; driver: string | null;
  classes: { name: string; range: string; products: string[]; readings: { stage: string; valueC: number; status: string; at: Date; by: string | null; accepted: boolean | null }[] }[];
  incidents: { number: string; stage: string; valueC: number; decision: string; cls: string }[];
  trip: { logger: string; minC: number; maxC: number; avgC: number; minutesOut: number; from: Date; to: Date; count: number } | null;
};

function CertificateDoc({ c }: { c: Certificate }) {
  return (
    <Document title={`Certificado de temperatura ${c.number}`} author="FIRINGI">
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Certificado de temperatura</Text>
        <Text style={s.muted}>Temperature certificate · HACCP · FIRINGI</Text>
        <View style={[s.between, { marginTop: 12 }]}>
          <View style={s.box}><Text style={s.muted}>Encomenda / Order</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{c.number}</Text><Text>Entregue / Delivered: {dt(c.deliveredAt)} UTC</Text>{c.vehicle ? <Text>Veículo / Vehicle: {c.vehicle}</Text> : null}{c.driver ? <Text>Motorista / Driver: {c.driver}</Text> : null}</View>
          <View style={s.box}><Text style={s.muted}>Fornecedor / Supplier</Text><Text>{c.supplier}</Text><Text style={[s.muted, { marginTop: 4 }]}>Cliente / Customer</Text><Text>{c.customer}</Text><Text>{c.address}</Text></View>
        </View>
        {c.classes.map((k, i) => (
          <View key={i} wrap={false}>
            <Text style={s.h2}>{k.name}  ·  {k.range}</Text>
            <Text style={s.muted}>{k.products.join(", ")}</Text>
            <View style={[s.th, { marginTop: 4 }]}><Text style={{ width: "28%" }}>Etapa / Stage</Text><Text style={{ width: "16%" }}>Temp.</Text><Text style={{ width: "22%" }}>Estado / Status</Text><Text style={{ width: "34%" }}>Data, por / Time, by</Text></View>
            {k.readings.length ? k.readings.map((r, j) => (
              <View key={j} style={s.row}>
                <Text style={{ width: "28%" }}>{STAGE[r.stage] ?? r.stage}</Text>
                <Text style={[{ width: "16%" }, r.status === "OUT" ? s.out : r.status === "WARN" ? s.warn : {}]}>{c1(r.valueC)}</Text>
                <Text style={{ width: "22%" }}>{STATUS[r.status] ?? r.status}{r.accepted === false ? " · recusado / refused" : ""}</Text>
                <Text style={{ width: "34%" }}>{dt(r.at)}{r.by ? ` · ${r.by}` : ""}</Text>
              </View>
            )) : <Text style={s.muted}>Sem leituras / No readings</Text>}
          </View>
        ))}
        {c.trip ? (
          <View wrap={false}>
            <Text style={s.h2}>Registador do veículo / Vehicle logger: {c.trip.logger}</Text>
            <Text>{dt(c.trip.from)} → {dt(c.trip.to)} UTC · {c.trip.count} leituras / readings</Text>
            <Text>Mín / Min {c1(c.trip.minC)} · Máx / Max {c1(c.trip.maxC)} · Média / Avg {c1(c.trip.avgC)} · Fora do intervalo / Out of range: {c.trip.minutesOut} min</Text>
          </View>
        ) : null}
        {c.incidents.length ? (
          <View wrap={false}>
            <Text style={s.h2}>Ocorrências / Incidents</Text>
            {c.incidents.map((i, j) => <Text key={j}>{i.number} · {i.cls} · {STAGE[i.stage] ?? i.stage} · {c1(i.valueC)} · {DECISION[i.decision] ?? i.decision}</Text>)}
          </View>
        ) : null}
        <Text style={[s.muted, { marginTop: 18 }]}>Documento gerado pela FIRINGI a partir das leituras registadas. / Generated by FIRINGI from the recorded readings.</Text>
      </Page>
    </Document>
  );
}

export type MonthlyReport = {
  month: string; company: string; vat: string | null; side: string; incidents: number;
  rows: { at: Date; order: string; counterpart: string; product: string; stage: string; cls: string; range: string; valueC: number; status: string; accepted: boolean | null }[];
};

function ReportDoc({ r }: { r: MonthlyReport }) {
  const out = r.rows.filter((x) => x.status === "OUT").length;
  return (
    <Document title={`HACCP ${r.month}`} author="FIRINGI">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>Registo HACCP de temperaturas — {r.month}</Text>
        <Text style={s.muted}>HACCP temperature record · {r.company}{r.vat ? ` · ${r.vat}` : ""} · {r.rows.length} leituras / readings · {out} fora do intervalo / out of range · {r.incidents} ocorrências / incidents</Text>
        <View style={[s.th, { marginTop: 10 }]} fixed>
          <Text style={{ width: "12%" }}>Data / Date</Text><Text style={{ width: "12%" }}>Encomenda / Order</Text><Text style={{ width: "18%" }}>Fornecedor / Cliente</Text><Text style={{ width: "16%" }}>Produto / Product</Text>
          <Text style={{ width: "12%" }}>Etapa / Stage</Text><Text style={{ width: "14%" }}>Classe / Class</Text><Text style={{ width: "7%" }}>Temp.</Text><Text style={{ width: "9%" }}>Estado</Text>
        </View>
        {r.rows.map((x, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={{ width: "12%" }}>{dt(x.at)}</Text><Text style={{ width: "12%" }}>{x.order}</Text><Text style={{ width: "18%" }}>{x.counterpart}</Text><Text style={{ width: "16%" }}>{x.product}</Text>
            <Text style={{ width: "12%" }}>{STAGE[x.stage] ?? x.stage}</Text><Text style={{ width: "14%" }}>{x.cls} {x.range}</Text>
            <Text style={[{ width: "7%" }, x.status === "OUT" ? s.out : x.status === "WARN" ? s.warn : {}]}>{c1(x.valueC)}</Text><Text style={{ width: "9%" }}>{x.status}{x.accepted === false ? " ✗" : ""}</Text>
          </View>
        ))}
        {!r.rows.length ? <Text style={[s.muted, { marginTop: 8 }]}>Sem leituras neste mês / No readings this month</Text> : null}
      </Page>
    </Document>
  );
}

export const renderCertificate = (c: Certificate) => renderToBuffer(<CertificateDoc c={c} />);
export const renderMonthlyReport = (r: MonthlyReport) => renderToBuffer(<ReportDoc r={r} />);
