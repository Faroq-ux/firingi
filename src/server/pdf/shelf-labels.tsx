/**
 * Shelf price labels (shops): A4 sheets (21 / 12 / 4), shelf-edge strips (27) and label-printer rolls, one label per
 * cell. Each label: product name, brand / origin (optional), the price incl. VAT large, the unit price (€/kg, €/L),
 * the product's own barcode as scannable bars (or a QR to the product's food information), promo (red, the old price
 * struck), shop name and date (optional). DejaVu Sans: every letter of the 25 languages.
 */
import React from "react";
import path from "node:path";
import QRCode from "qrcode";
import { Document, Font, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ShelfLabel } from "@prisma/client";
import { shownPrice, unitPrice, type FormatSpec, type LabelFields } from "@/lib/shelf-labels";
import { barRuns, eanModules } from "@/lib/marketing-catalogue";

let fonts = false;
function registerFonts() {
  if (fonts) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({ family: "DejaVu", fonts: [{ src: path.join(dir, "DejaVuSans.ttf") }, { src: path.join(dir, "DejaVuSans-Bold.ttf"), fontWeight: "bold" }] });
  Font.registerHyphenationCallback((w) => [w]);
  fonts = true;
}

const RED = "#E10600";
export type ShelfPdfLabels = { perKg: string; perL: string; promo: string; was: string; until: string; origin: string };
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

function Bars({ modules, digits, module, height }: { modules: string; digits: string; module: number; height: number }) {
  const w = (modules.length + 14) * module;
  return (
    <View style={{ width: w }}>
      <View style={{ height, width: w, position: "relative", backgroundColor: "#fff" }}>
        {barRuns(modules).map(([x, n], k) => <View key={k} style={{ position: "absolute", left: (x + 7) * module, top: 0, width: n * module, height, backgroundColor: "#000" }} />)}
      </View>
      <Text style={{ fontSize: Math.max(4.5, module * 6), textAlign: "center", letterSpacing: 0.6 }}>{digits}</Text>
    </View>
  );
}

export async function renderShelfLabelsPdf(i: {
  /** page and label layout (a standard size or the shop's own) */
  spec: FormatSpec;
  /** CUT: light dashed cut lines (plain paper); NONE: nothing (sticker sheets, rolls); TEST: solid outlines to check alignment */
  borders?: "CUT" | "NONE" | "TEST";
  fields: LabelFields; locale: string; baseUrl: string; shopName: string; date: Date; labels: ShelfLabel[]; l: ShelfPdfLabels;
  /** a QR where a label has no barcode that can be drawn (FIRINGI allows QR codes) */
  qrFallback?: boolean;
}) {
  registerFonts();
  const f = i.spec;
  const border = i.borders === "TEST" ? { borderWidth: 0.6, borderColor: "#111827", borderStyle: "solid" as const } : i.borders === "NONE" ? {} : { borderWidth: 0.4, borderColor: "#d1d5db", borderStyle: "dashed" as const };
  const per = f.cols * f.rows;
  const nf = new Intl.NumberFormat(i.locale, { style: "currency", currency: "EUR" });
  const df = new Intl.DateTimeFormat(i.locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  let regionNames: Intl.DisplayNames | null = null;
  try { regionNames = new Intl.DisplayNames([i.locale], { type: "region" }); } catch { regionNames = null; }
  // the type sizes by label size (low roll labels get a shorter barcode)
  const low = f.h < 31 * 2.83;
  // bar width: at least 0.26 mm (80 % of the EAN standard) so tills and phones read it
  const T = f.size === "L" ? { name: 20, sub: 11, price: 60, unit: 11, mod: 1.4, barH: 40, qr: 80, pad: 14 }
    : f.size === "M" ? { name: 11, sub: 7.5, price: 30, unit: 7.5, mod: 0.95, barH: 22, qr: 44, pad: 7 }
    : { name: low ? 7.5 : 8.5, sub: 6, price: low ? 15 : 20, unit: 6, mod: f.w > 160 ? 0.85 : 0.75, barH: low ? 12 : 18, qr: low ? 26 : 32, pad: low ? 3.5 : 4.5 };
  // very low labels (own sizes under 29 mm): smaller type and shorter bars — never thinner bars
  const k = f.size === "S" && f.h < 29 * 2.83 ? Math.max(0.6, f.h / (29 * 2.83)) : 1;
  if (k < 1) Object.assign(T, { name: T.name * k, sub: Math.max(4.5, T.sub * k), price: T.price * k, unit: Math.max(4.5, T.unit * k), barH: Math.max(8, T.barH * k), qr: T.qr * k, pad: T.pad * k });
  /** a barcode fits across the label (95 modules + quiet zones) */
  const barsFit = (modules: number) => (modules + 14) * T.mod <= f.w - 2 * T.pad;
  /** the price as large as it fits on one line (DejaVu Sans Bold digits ≈ 0.64 em) */
  /** narrow labels: shop and date go under the name, the barcode keeps its quiet zone free */
  const narrow = f.w < 130;
  const shopLine = [i.fields.shopName ? i.shopName : null, i.fields.date ? df.format(i.date) : null].filter(Boolean).join(" · ");
  /** the name in at most 2 lines (small labels) or 3 lines */
  const fit = (name: string) => { const max = Math.floor((f.w - 2 * T.pad) / (T.name * 0.6)) * (f.size === "S" ? 2 : 3); return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name; };
  const priceSize = (text: string) => Math.min(T.price, (f.w - 2 * T.pad) / (text.length * 0.64));
  const qrs = new Map<string, string>();
  if (i.fields.code !== "NONE") {
    for (const l of i.labels) {
      const wantQr = i.fields.code === "QR" || (i.qrFallback !== false && !eanModules(l.barcode));
      if (wantQr && l.productId && !qrs.has(l.productId)) qrs.set(l.productId, await QRCode.toDataURL(`${i.baseUrl}/food/${l.productId}?lang=${i.locale}`, { margin: 0, width: 160, errorCorrectionLevel: "M" }));
    }
  }
  const pages: ShelfLabel[][] = [];
  for (let k = 0; k < i.labels.length; k += per) pages.push(i.labels.slice(k, k + per));

  const one = (l: ShelfLabel) => {
    const s = shownPrice({ priceGross: l.priceGross.toString(), promoPrice: l.promoPrice?.toString() ?? null, promoUntil: l.promoUntil }, i.date);
    const up = i.fields.unitPrice ? unitPrice(s.price, l.content?.toString() ?? null, l.contentUnit) : null;
    // the product barcode; with QR chosen, still the barcode where there is no QR (a till item without a FIRINGI product)
    const bars = i.fields.code === "BARCODE" || (i.fields.code === "QR" && !l.productId) ? eanModules(l.barcode) : null;
    const qr = !bars && (i.fields.code === "QR" || i.qrFallback !== false) && i.fields.code !== "NONE" && l.productId ? qrs.get(l.productId) : null;
    const origin = i.fields.origin && l.originCountryCode ? fill(i.l.origin, { country: regionNames?.of(l.originCountryCode) ?? l.originCountryCode }) : null;
    const sub = [i.fields.brand ? l.brand : null, origin].filter(Boolean).join(" · ");
    const priceText = nf.format(s.price.toNumber());
    return (
      <View style={{ width: f.w, height: f.h, padding: T.pad, ...border, justifyContent: "space-between" }}>
        {s.promo && <View style={{ position: "absolute", top: 0, left: 0, right: 0, backgroundColor: RED, paddingVertical: 1 }}><Text style={{ color: "#fff", fontSize: T.sub, fontWeight: "bold", textAlign: "center" }}>{i.l.promo}{l.promoUntil ? ` · ${fill(i.l.until, { date: df.format(l.promoUntil) })}` : ""}</Text></View>}
        <View style={{ marginTop: s.promo ? T.sub + 3 : 0 }}>
          <Text style={{ fontSize: T.name, fontWeight: "bold" }} hyphenationCallback={(w) => [w]}>{fit(l.name)}</Text>
          {!!sub && <Text style={{ fontSize: T.sub, color: "#4b5563" }}>{sub}</Text>}
          {narrow && !!shopLine && <Text style={{ fontSize: T.unit - 1, color: "#6b7280" }}>{shopLine}</Text>}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {s.was && <Text style={{ fontSize: T.unit + 1, color: "#6b7280", textDecoration: "line-through" }}>{fill(i.l.was, { price: nf.format(s.was.toNumber()) })}</Text>}
          <Text style={{ fontSize: priceSize(priceText), fontWeight: "bold", color: s.promo ? RED : "#111827", lineHeight: 1 }}>{priceText}</Text>
          {up && <Text style={{ fontSize: T.unit }}>{nf.format(up.toNumber())}{l.contentUnit === "KG" ? i.l.perKg : i.l.perL}</Text>}
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          {bars && barsFit(bars.modules.length) ? <Bars modules={bars.modules} digits={bars.digits} module={T.mod} height={T.barH} /> : bars ? <Text style={{ fontSize: T.unit, letterSpacing: 0.6 }}>{bars.digits}</Text> : qr ? <Image src={qr} style={{ width: T.qr, height: T.qr }} /* eslint-disable-line jsx-a11y/alt-text */ /> : <View />}
          {!narrow && <View style={{ alignItems: "flex-end" }}>
            {i.fields.shopName && !!i.shopName && <Text style={{ fontSize: T.unit - 1, color: "#6b7280" }}>{i.shopName}</Text>}
            {i.fields.date && <Text style={{ fontSize: T.unit - 1.5, color: "#9ca3af" }}>{df.format(i.date)}</Text>}
          </View>}
        </View>
      </View>
    );
  };

  const doc = (
    <Document title="FIRINGI shelf labels" author="FIRINGI" language={i.locale}>
      {pages.map((pg, n) => (
        <Page key={n} size={[f.pageW, f.pageH]} style={{ fontFamily: "DejaVu", color: "#111827", position: "relative" }}>
          {pg.map((l, k) => {
            const col = k % f.cols, row = Math.floor(k / f.cols);
            return <View key={k} style={{ position: "absolute", left: f.mx + col * (f.w + (f.gx ?? 0)), top: f.my + row * (f.h + (f.gy ?? 0)) }}>{one(l)}</View>;
          })}
        </Page>
      ))}
    </Document>
  );
  return renderToBuffer(doc);
}
