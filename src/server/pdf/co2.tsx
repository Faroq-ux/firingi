/** Phase 51: the CO₂ report as a PDF (CSRD-style Scope 3 summary), in the reader's language (DejaVu Sans). */
import React from "react";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { co2ReportFor } from "@/server/co2/service";

let fonts = false;
function registerFonts() {
  if (fonts) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({ family: "DejaVu", fonts: [{ src: path.join(dir, "DejaVuSans.ttf") }, { src: path.join(dir, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }] });
  Font.registerHyphenationCallback((w) => [w]);
  fonts = true;
}
const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "DejaVu", color: "#111827" },
  h1: { fontSize: 16, fontWeight: "bold", marginBottom: 2 },
  h2: { fontSize: 11, fontWeight: "bold", marginTop: 14, marginBottom: 4 },
  muted: { color: "#6b7280" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 3 },
  th: { flexDirection: "row", backgroundColor: "#f3f4f6", fontWeight: "bold", paddingVertical: 3 },
  tile: { flex: 1, borderWidth: 0.5, borderColor: "#d1d5db", borderRadius: 4, padding: 6, marginRight: 6 },
});
type R = Awaited<ReturnType<typeof co2ReportFor>>;

export async function renderCo2Pdf(i: { r: R; company: string; locale: string; l: Record<string, string>; partyLabel: string }) {
  registerFonts();
  const { r, l } = i;
  const kg = (n: number) => `${new Intl.NumberFormat(i.locale, { maximumFractionDigits: 1 }).format(n)} kg CO₂e`;
  const month = (m: number) => new Intl.DateTimeFormat(i.locale, { month: "long" }).format(new Date(Date.UTC(r.year, m - 1, 1)));
  const T = ({ cells, head }: { cells: string[]; head?: boolean }) => <View style={head ? s.th : s.row}>{cells.map((c, k) => <Text key={k} style={{ flex: k === 0 ? 2 : 1, textAlign: k === 0 ? "left" : "right", paddingHorizontal: 3 }}>{c}</Text>)}</View>;
  const doc = (
    <Document title={`${l.pdfTitle} ${r.year}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{l.pdfTitle} {r.year}</Text>
        <Text style={s.muted}>{i.company} · {new Intl.DateTimeFormat(i.locale, { dateStyle: "long" }).format(new Date())}</Text>
        <View style={{ flexDirection: "row", marginTop: 12 }}>
          <View style={s.tile}><Text style={s.muted}>{l.totalYear}</Text><Text style={{ fontSize: 12, fontWeight: "bold" }}>{kg(r.total)}</Text></View>
          <View style={s.tile}><Text style={s.muted}>{l.products}</Text><Text>{kg(r.parts.products)}</Text></View>
          <View style={s.tile}><Text style={s.muted}>{l.packagingPart}</Text><Text>{kg(r.parts.packaging)}</Text></View>
          <View style={s.tile}><Text style={s.muted}>{l.delivery}</Text><Text>{kg(r.parts.delivery)}</Text></View>
        </View>
        <Text style={s.h2}>{l.scopeTitle}</Text>
        <T head cells={[l.scope, "kg CO₂e"]} />
        <T cells={[l.scope1, (r.parts.products + r.parts.packaging).toFixed(1)]} />
        <T cells={[l.scope4, r.parts.delivery.toFixed(1)]} />
        <Text style={s.h2}>{l.byMonth}</Text>
        <T head cells={["", l.products, l.packagingPart, l.delivery, l.total]} />
        {r.months.map((m) => <T key={m.month} cells={[month(m.month), m.products.toFixed(1), m.packaging.toFixed(1), m.delivery.toFixed(1), m.total.toFixed(1)]} />)}
        <Text style={s.h2}>{l.byCategory}</Text>
        <T head cells={["", "kg CO₂e"]} />
        {r.categories.slice(0, 15).map((c) => <T key={c.name} cells={[c.name, c.kg.toFixed(1)]} />)}
        <Text style={s.h2}>{i.partyLabel}</Text>
        <T head cells={["", "kg CO₂e"]} />
        {r.parties.slice(0, 15).map((p) => <T key={p.name} cells={[p.name, p.kg.toFixed(1)]} />)}
        <Text style={[s.muted, { marginTop: 14 }]}>{l.method}</Text>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
