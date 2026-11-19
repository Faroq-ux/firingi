/**
 * Phase 44 PDFs for resellers, in the customer's own language (DejaVu Sans: every letter of the 25 languages):
 *   • the allergen book — products × the 14 EU allergens, then each product's ingredients (allergens in bold),
 *     to show guests or a food inspector;
 *   • shelf labels — allergens and diets per product with a QR code to the public product page.
 */
import React from "react";
import path from "node:path";
import QRCode from "qrcode";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { ALLERGENS, ingredientSegments, LEVEL_MARK, pickLang, type FoodData, type Level } from "@/lib/food";

let fonts = false;
function registerFonts() {
  if (fonts) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({ family: "DejaVu", fonts: [{ src: path.join(dir, "DejaVuSans.ttf") }, { src: path.join(dir, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }] });
  Font.registerHyphenationCallback((w) => [w]);
  fonts = true;
}

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "DejaVu", color: "#111827" },
  h1: { fontSize: 15, fontWeight: "bold", marginBottom: 2 },
  h2: { fontSize: 11, fontWeight: "bold", marginTop: 12, marginBottom: 4 },
  muted: { color: "#6b7280" },
  bold: { fontWeight: "bold" },
  th: { flexDirection: "row", backgroundColor: "#f3f4f6", fontWeight: "bold", paddingVertical: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 3, alignItems: "center" },
});

export type FoodPdfLabels = Record<string, string>;
type Item = { productId: string; name: string; sku: string; data: FoodData | null };
const MARK_COLOR: Record<Level, string> = { CONTAINS: "#b91c1c", MAY_CONTAIN: "#b45309", FREE: "#9ca3af" };

/** The allergen book for a customer. */
export async function renderAllergenBook(i: { company: string; locale: string; items: Item[]; l: FoodPdfLabels }) {
  registerFonts();
  const { l } = i;
  const date = new Intl.DateTimeFormat(i.locale, { dateStyle: "long" }).format(new Date());
  const withData = i.items.filter((x) => x.data);
  const doc = (
    <Document title={l.bookTitle}>
      <Page size="A4" orientation="landscape" style={s.page} wrap>
        <Text style={s.h1}>{l.bookTitle}</Text>
        <Text style={s.muted}>{i.company} · {date} · {l.bookSource}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{LEVEL_MARK.CONTAINS} {l["level.CONTAINS"]}   {LEVEL_MARK.MAY_CONTAIN} {l["level.MAY_CONTAIN"]}   {LEVEL_MARK.FREE} {l["level.FREE"]}   ? {l.notStated}</Text>
        <View style={[s.th, { marginTop: 8 }]} fixed>
          <Text style={{ flex: 3.2, paddingLeft: 2 }}>{l.product}</Text>
          {ALLERGENS.map((a) => <Text key={a} style={{ flex: 1, textAlign: "center", fontSize: 6.5 }}>{l[`a.${a}`]}</Text>)}
        </View>
        {i.items.map((x) => (
          <View key={x.productId} style={s.row} wrap={false}>
            <Text style={{ flex: 3.2, paddingLeft: 2 }}>{x.name}<Text style={s.muted}> · {x.sku}</Text></Text>
            {ALLERGENS.map((a) => {
              const lv = x.data?.allergens[a];
              return <Text key={a} style={{ flex: 1, textAlign: "center", fontSize: 10, color: lv ? MARK_COLOR[lv] : "#d1d5db" }}>{lv ? LEVEL_MARK[lv] : "?"}</Text>;
            })}
          </View>
        ))}
        {!i.items.length && <Text style={[s.muted, { marginTop: 8 }]}>{l.noProducts}</Text>}
        {withData.length > 0 && <Text style={s.h2} break>{l.ingredients}</Text>}
        {withData.map((x) => {
          const ing = pickLang(x.data!.ingredients, i.locale);
          const may = ALLERGENS.filter((a) => x.data!.allergens[a] === "MAY_CONTAIN").map((a) => l[`a.${a}`]);
          return (
            <View key={x.productId} style={{ marginBottom: 6 }} wrap={false}>
              <Text style={s.bold}>{x.name}</Text>
              {ing ? <Text>{ingredientSegments(ing.text).map((g, k) => <Text key={k} style={g.b ? s.bold : {}}>{g.t}</Text>)}</Text> : <Text style={s.muted}>—</Text>}
              {may.length > 0 && <Text style={{ color: "#b45309" }}>{l["level.MAY_CONTAIN"]}: {may.join(", ")}</Text>}
            </View>
          );
        })}
        <Text style={[s.muted, { position: "absolute", bottom: 14, left: 28, right: 28, fontSize: 6.5 }]} fixed render={({ pageNumber, totalPages }) => `${l.bookFooter} · ${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}

/** Shelf labels (A4, 3 × 7) with a QR code to the public product page. */
export async function renderShelfLabels(i: { locale: string; baseUrl: string; items: Item[]; l: FoodPdfLabels }) {
  registerFonts();
  const { l } = i;
  const items = i.items.filter((x) => x.data);
  const qrs = await Promise.all(items.map((x) => QRCode.toDataURL(`${i.baseUrl}/food/${x.productId}?lang=${i.locale}`, { margin: 0, width: 200, errorCorrectionLevel: "M" })));
  const list = (codes: string[]) => codes.map((a) => l[`a.${a}`]).join(", ");
  const doc = (
    <Document title={l.labelsTitle}>
      <Page size="A4" style={{ padding: 18, fontFamily: "DejaVu", fontSize: 7, flexDirection: "row", flexWrap: "wrap" }}>
        {items.map((x, k) => {
          const d = x.data!;
          const contain = ALLERGENS.filter((a) => d.allergens[a] === "CONTAINS");
          const may = ALLERGENS.filter((a) => d.allergens[a] === "MAY_CONTAIN");
          return (
            <View key={x.productId} wrap={false} style={{ width: "33.33%", height: 113, padding: 6, borderWidth: 0.5, borderColor: "#d1d5db", borderStyle: "dashed", flexDirection: "row" }}>
              <View style={{ flex: 1, paddingRight: 4 }}>
                <Text style={{ fontSize: 8.5, fontWeight: "bold" }}>{x.name}</Text>
                <Text style={{ marginTop: 3 }}><Text style={s.bold}>{l.contains}: </Text>{contain.length ? list(contain) : l.noneOf14}</Text>
                {may.length > 0 && <Text style={{ marginTop: 2, color: "#b45309" }}><Text style={s.bold}>{l["level.MAY_CONTAIN"]}: </Text>{list(may)}</Text>}
                {d.diets.length > 0 && <Text style={{ marginTop: 2, color: "#047857" }}>{d.diets.map((x2) => l[`diet.${x2}`]).join(" · ")}</Text>}
                <Text style={{ marginTop: 3, color: "#6b7280", fontSize: 6 }}>{l.scan}</Text>
              </View>
              <Image src={qrs[k]} style={{ width: 58, height: 58 }} />
            </View>
          );
        })}
        {!items.length && <Text>{l.noProducts}</Text>}
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
