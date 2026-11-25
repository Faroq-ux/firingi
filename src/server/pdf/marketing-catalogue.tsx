/**
 * Marketing catalogue PDF (FIRINGI): a cover (title, subtitle, intro, the FIRINGI wordmark in red with the yellow
 * line), then the products in 4 / 6 / 9 per page or a list, with section headers — photo, name, brand, pack, barcode,
 * minimum order, price (as FIRINGI chose) and a QR code that opens the product in the shop. DejaVu Sans: every letter
 * of the 25 languages.
 */
import React from "react";
import path from "node:path";
import QRCode from "qrcode";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { GRID_COLS, ROW_H, packPages, type McLayout, type McOptions } from "@/lib/marketing-catalogue";
import type { McEntry } from "@/server/marketing/catalogues";

let fonts = false;
function registerFonts() {
  if (fonts) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({ family: "DejaVu", fonts: [{ src: path.join(dir, "DejaVuSans.ttf") }, { src: path.join(dir, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }] });
  Font.registerHyphenationCallback((w) => [w]);
  fonts = true;
}

const RED = "#E10600", YELLOW = "#FFC800", INK = "#111827", MUTED = "#6b7280";
const s = StyleSheet.create({
  page: { padding: 28, paddingBottom: 40, fontSize: 8, fontFamily: "DejaVu", color: INK },
  cover: { padding: 48, fontFamily: "DejaVu", color: INK, justifyContent: "space-between" },
  brand: { fontSize: 44, fontWeight: "bold", color: RED, letterSpacing: 2 },
  bar: { height: 6, width: 120, backgroundColor: YELLOW, marginTop: 6 },
  title: { fontSize: 30, fontWeight: "bold", marginTop: 60 },
  subtitle: { fontSize: 15, color: MUTED, marginTop: 8 },
  intro: { fontSize: 11, marginTop: 24, lineHeight: 1.5, maxWidth: 420 },
  section: { fontSize: 13, fontWeight: "bold", color: RED, marginBottom: 8, paddingBottom: 3, borderBottomWidth: 2, borderColor: YELLOW },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  card: { borderWidth: 0.6, borderColor: "#e5e7eb", borderRadius: 6, padding: 8, marginBottom: 8 },
  name: { fontSize: 10, fontWeight: "bold" },
  muted: { color: MUTED },
  price: { fontSize: 12, fontWeight: "bold", color: RED, marginTop: 3 },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderColor: "#e5e7eb", paddingVertical: 5 },
});

export type McPdfLabels = { priceNet: string; priceGross: string; minOrder: string; barcode: string; unitBarcode: string; scan: string; pricesNote: string; page: string; soldBy: string };
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

export async function renderMarketingCatalogue(i: {
  title: string; subtitle: string | null; intro: string | null; locale: string; layout: McLayout; options: McOptions;
  entries: McEntry[]; images: Map<string, Buffer>; baseUrl: string; l: McPdfLabels; money: (amount: string) => string;
}) {
  registerFonts();
  const cols = GRID_COLS[i.layout];
  const qrs = i.options.qr ? new Map(await Promise.all(i.entries.map(async (e) => [e.offerId, await QRCode.toDataURL(`${i.baseUrl}/buy/catalogue/offers/${e.offerId}`, { margin: 0, width: 160, errorCorrectionLevel: "M" })] as const))) : new Map<string, string>();
  const pages = packPages(i.entries, cols, ROW_H[i.layout]);
  const list = i.layout === "LIST";
  const cardW = cols === 3 ? "32%" : "49%";
  const imgH = i.layout === "GRID4" ? 230 : i.layout === "GRID6" ? 120 : 110;
  const price = (e: McEntry) => i.options.price === "GROSS" ? (e.priceGross ? fill(i.l.priceGross, { price: i.money(e.priceGross) }) : null) : i.options.price === "NET" && e.priceNet ? fill(i.l.priceNet, { price: i.money(e.priceNet) }) : null;
  const details = (e: McEntry) => (
    <>
      <Text style={s.name}>{e.name}</Text>
      {!!e.brand && <Text style={s.muted}>{e.brand}</Text>}
      {i.options.qty && <Text>{e.pack}{e.minQty > 1 ? ` · ${fill(i.l.minOrder, { qty: e.minQty })}` : ""}</Text>}
      {!!e.supplier && <Text style={s.muted}>{fill(i.l.soldBy, { name: e.supplier })}</Text>}
      {!!e.gtin && <Text style={s.muted}>{fill(i.l.barcode, { code: e.gtin })}</Text>}
      {!!e.unitGtin && e.unitGtin !== e.gtin && <Text style={s.muted}>{fill(i.l.unitBarcode, { code: e.unitGtin })}</Text>}
      {!!price(e) && <Text style={s.price}>{price(e)}</Text>}
    </>
  );
  const doc = (
    <Document title={i.title} author="FIRINGI" language={i.locale}>
      <Page size="A4" style={s.cover}>
        <View>
          <Text style={s.brand}>FIRINGI</Text>
          <View style={s.bar} />
          <Text style={s.title}>{i.title}</Text>
          {!!i.subtitle && <Text style={s.subtitle}>{i.subtitle}</Text>}
          {!!i.intro && <Text style={s.intro}>{i.intro}</Text>}
        </View>
        {i.options.price !== "NONE" && <Text style={s.muted}>{i.l.pricesNote}</Text>}
      </Page>
      {pages.map((pg, n) => (
        <Page key={n} size="A4" style={s.page}>
          {pg.map((b, k) => b.kind === "header" ? <Text key={k} style={s.section}>{b.title}</Text> : list ? b.items.map((e) => (
            <View key={e.offerId} style={s.row} wrap={false}>
              {i.images.get(e.productId) ? <Image src={i.images.get(e.productId)!} style={{ width: 40, height: 40, objectFit: "contain", marginRight: 8 }} /> : <View style={{ width: 40, marginRight: 8 }} />}
              <View style={{ flex: 1 }}>{details(e)}</View>
              {qrs.get(e.offerId) && <Image src={qrs.get(e.offerId)!} style={{ width: 36, height: 36, marginLeft: 8 }} />}
            </View>
          )) : (
            <View key={k} style={s.grid}>
              {b.items.map((e) => (
                <View key={e.offerId} style={[s.card, { width: cardW }]} wrap={false}>
                  <View style={{ height: imgH, alignItems: "center", justifyContent: "center", marginBottom: 6, backgroundColor: "#f9fafb", borderRadius: 4 }}>
                    {i.images.get(e.productId) ? <Image src={i.images.get(e.productId)!} style={{ maxHeight: imgH - 6, maxWidth: "95%", objectFit: "contain" }} /> : <Text style={[s.muted, { fontSize: 18 }]}>FIRINGI</Text>}
                  </View>
                  <View style={{ flexDirection: "row" }}>
                    <View style={{ flex: 1 }}>{details(e)}</View>
                    {qrs.get(e.offerId) && <View style={{ alignItems: "center", marginLeft: 4 }}><Image src={qrs.get(e.offerId)!} style={{ width: cols === 3 ? 34 : 44, height: cols === 3 ? 34 : 44 }} /><Text style={{ fontSize: 5, color: MUTED }}>{i.l.scan}</Text></View>}
                  </View>
                </View>
              ))}
            </View>
          ))}
          <View style={s.footer} fixed>
            <Text><Text style={{ color: RED, fontWeight: "bold" }}>FIRINGI</Text> · {i.title}</Text>
            <Text render={({ pageNumber }) => fill(i.l.page, { n: pageNumber })} />
          </View>
        </Page>
      ))}
    </Document>
  );
  return renderToBuffer(doc);
}
