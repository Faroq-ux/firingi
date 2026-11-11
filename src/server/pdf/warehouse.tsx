/**
 * Warehouse documents (Phase 25, @react-pdf/renderer): shelf labels, lot labels, packing slips and
 * box labels. Every label carries a QR code the FIRINGI scanner reads (FIR:L / FIR:B / FIR:O).
 * Texts are Portuguese with English second, like the purchase order. No prices on any of them.
 */
import React from "react";
import QRCode from "qrcode";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { width: "48.5%", height: 132, borderWidth: 1, borderColor: "#111827", borderRadius: 6, padding: 8, flexDirection: "row", gap: 8 },
  big: { fontSize: 26, fontFamily: "Helvetica-Bold" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#6b7280" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  th: { fontFamily: "Helvetica-Bold", backgroundColor: "#f3f4f6", paddingVertical: 4, paddingHorizontal: 3 },
  td: { paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 0.5, borderColor: "#e5e7eb" },
  box: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 4, padding: 8, width: "48%" },
});

const qr = (text: string) => QRCode.toDataURL(text, { margin: 0, width: 240, errorCorrectionLevel: "M" });
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

export type BinLabel = { id: string; code: string; zone: string | null; warehouse: string; company: string };
export type LotLabel = { id: string; product: string; packaging: string; sku: string | null; gtin: string | null; lotCode: string | null; expiresOn: Date | null; bin: string | null; company: string };
export type PackingSlip = {
  orderNumber: string; date: Date; pickList: string; boxes: number; supplier: string; warehouse: string;
  buyer: string; address: string[]; requestedDeliveryDate: Date | null;
  lines: { product: string; packaging: string; sku: string | null; lotCode: string | null; expiresOn: Date | null; qty: number; short: number }[];
};

function BinLabelsDoc({ rows, qrs }: { rows: BinLabel[]; qrs: string[] }) {
  return (
    <Document title="Shelf labels" author="FIRINGI">
      <Page size="A4" style={s.page}>
        <View style={s.grid}>
          {rows.map((b, i) => (
            <View key={b.id} style={s.label} wrap={false}>
              <Image src={qrs[i]} style={{ width: 112, height: 112 }} />
              <View style={{ flex: 1, justifyContent: "space-between" }}>
                <View><Text style={s.muted}>Prateleira / Shelf</Text><Text style={s.big}>{b.code}</Text>{b.zone ? <Text style={s.bold}>{b.zone}</Text> : null}</View>
                <View><Text>{b.warehouse}</Text><Text style={s.muted}>{b.company}</Text></View>
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

function LotLabelsDoc({ rows, qrs }: { rows: LotLabel[]; qrs: string[] }) {
  return (
    <Document title="Lot labels" author="FIRINGI">
      <Page size="A4" style={s.page}>
        <View style={s.grid}>
          {rows.map((b, i) => (
            <View key={b.id} style={s.label} wrap={false}>
              <Image src={qrs[i]} style={{ width: 104, height: 104 }} />
              <View style={{ flex: 1, justifyContent: "space-between" }}>
                <View>
                  <Text style={[s.bold, { fontSize: 11 }]}>{b.product}</Text>
                  <Text>{b.packaging}{b.sku ? `  ·  ${b.sku}` : ""}</Text>
                </View>
                <View>
                  <Text style={s.muted}>Lote / Lot</Text><Text style={[s.bold, { fontSize: 15 }]}>{b.lotCode ?? "—"}</Text>
                  <Text style={s.muted}>Validade / Best before</Text><Text style={[s.bold, { fontSize: 13 }]}>{day(b.expiresOn)}</Text>
                </View>
                <View style={s.between}><Text style={s.muted}>{b.gtin ?? ""}</Text><Text style={s.muted}>{b.bin ?? ""}</Text></View>
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

function PackingSlipDoc({ d, code }: { d: PackingSlip; code: string }) {
  const cols: [string, number, "left" | "right"][] = [["Produto / Product", 44, "left"], ["Ref.", 12, "left"], ["Lote / Lot", 16, "left"], ["Validade / Best before", 16, "left"], ["Qtd. / Qty", 12, "right"]];
  return (
    <Document title={`Packing slip ${d.orderNumber}`} author="FIRINGI">
      <Page size="A4" style={[s.page, { padding: 36 }]}>
        <View style={s.between}>
          <View><Text style={{ fontSize: 20, fontFamily: "Helvetica-Bold", color: "#1e3a8a" }}>FIRINGI</Text><Text style={s.muted}>Guia de embalagem / Packing slip</Text></View>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.bold, { fontSize: 14 }]}>{d.orderNumber}</Text>
              <Text>Data / Date: {day(d.date)}</Text>
              <Text>Volumes / Boxes: {d.boxes}</Text>
              <Text style={s.muted}>{d.pickList}</Text>
            </View>
            <Image src={code} style={{ width: 64, height: 64 }} />
          </View>
        </View>
        <View style={[s.between, { marginTop: 14 }]}>
          <View style={s.box}><Text style={[s.muted, { marginBottom: 3 }]}>Entregar a / Deliver to</Text><Text style={s.bold}>{d.buyer}</Text>{d.address.map((l, k) => <Text key={k}>{l}</Text>)}{d.requestedDeliveryDate ? <Text style={{ marginTop: 3 }}>Data pedida / Requested: {day(d.requestedDeliveryDate)}</Text> : null}</View>
          <View style={s.box}><Text style={[s.muted, { marginBottom: 3 }]}>Preparado por / Prepared by</Text><Text style={s.bold}>{d.supplier}</Text><Text>{d.warehouse}</Text></View>
        </View>
        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: "row" }}>{cols.map(([h, w, a]) => <Text key={h} style={[s.th, { width: `${w}%`, textAlign: a }]}>{h}</Text>)}</View>
          {d.lines.map((l, k) => (
            <View key={k} style={{ flexDirection: "row" }} wrap={false}>
              <Text style={[s.td, { width: "44%" }]}>{l.product} — {l.packaging}</Text>
              <Text style={[s.td, { width: "12%" }]}>{l.sku ?? ""}</Text>
              <Text style={[s.td, { width: "16%" }]}>{l.lotCode ?? "—"}</Text>
              <Text style={[s.td, { width: "16%" }]}>{day(l.expiresOn)}</Text>
              <Text style={[s.td, { width: "12%", textAlign: "right" }]}>{l.qty}{l.short ? ` (−${l.short})` : ""}</Text>
            </View>
          ))}
        </View>
        {d.lines.some((l) => l.short) ? <Text style={{ marginTop: 8, color: "#92400e" }}>(−n) = em falta, a FIRINGI informa o cliente / missing, FIRINGI informs the customer.</Text> : null}
        <Text style={{ position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 7, color: "#6b7280" }}>Faturado pela FIRINGI. Conferir os volumes à receção. / Invoiced by FIRINGI. Please check the boxes on delivery.</Text>
      </Page>
    </Document>
  );
}

function BoxLabelsDoc({ d, codes }: { d: Pick<PackingSlip, "orderNumber" | "buyer" | "address" | "boxes" | "supplier">; codes: string[] }) {
  return (
    <Document title={`Box labels ${d.orderNumber}`} author="FIRINGI">
      {codes.map((c, i) => (
        <Page key={i} size="A6" style={[s.page, { padding: 18 }]}>
          <View style={s.between}><Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1e3a8a" }}>FIRINGI</Text><Text style={[s.bold, { fontSize: 14 }]}>{i + 1} / {d.boxes}</Text></View>
          <Text style={[s.bold, { fontSize: 18, marginTop: 8 }]}>{d.orderNumber}</Text>
          <Text style={[s.bold, { fontSize: 12, marginTop: 6 }]}>{d.buyer}</Text>
          {d.address.map((l, k) => <Text key={k} style={{ fontSize: 10 }}>{l}</Text>)}
          <View style={{ alignItems: "center", marginTop: 10 }}><Image src={c} style={{ width: 120, height: 120 }} /></View>
          <Text style={[s.muted, { position: "absolute", bottom: 14, left: 18 }]}>{d.supplier}</Text>
        </Page>
      ))}
    </Document>
  );
}

export async function renderBinLabels(rows: BinLabel[]) {
  const qrs = await Promise.all(rows.map((b) => qr(`FIR:L:${b.id}`)));
  return renderToBuffer(<BinLabelsDoc rows={rows} qrs={qrs} />);
}
export async function renderLotLabels(rows: LotLabel[]) {
  const qrs = await Promise.all(rows.map((b) => qr(`FIR:B:${b.id}`)));
  return renderToBuffer(<LotLabelsDoc rows={rows} qrs={qrs} />);
}
export async function renderPackingSlip(d: PackingSlip) {
  return renderToBuffer(<PackingSlipDoc d={d} code={await qr(`FIR:O:${d.orderNumber}`)} />);
}
export async function renderBoxLabels(d: Pick<PackingSlip, "orderNumber" | "buyer" | "address" | "boxes" | "supplier">) {
  const codes = await Promise.all(Array.from({ length: Math.max(1, d.boxes) }, (_, i) => qr(`FIR:O:${d.orderNumber}:${i + 1}`)));
  return renderToBuffer(<BoxLabelsDoc d={d} codes={codes} />);
}
