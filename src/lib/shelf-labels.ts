/**
 * Shelf price labels for shops — pure rules: label sizes (A4 sheets, shelf-edge strips, label-printer rolls), what a
 * label shows, the selling price from a margin on today's cost, the unit price (€/kg, €/L — required on shelves in the
 * EU) and reading the net content from a product name ("Coca-Cola lata 33cl" → 0.33 L).
 */
import Decimal from "decimal.js";

const MM = 2.834645669; // points per millimetre

export const LABEL_FORMATS = ["A4_21", "A4_12", "A4_4", "STRIP_27", "ROLL_58x40", "ROLL_62x29", "ROLL_40x30"] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];
/** page and label sizes in points; `size` picks the type sizes */
export type FormatSpec = {
  pageW: number; pageH: number; cols: number; rows: number; w: number; h: number; mx: number; my: number; size: "S" | "M" | "L";
  /** gaps between labels (sticker sheets) */
  gx?: number; gy?: number;
};
const a4 = (cols: number, rows: number, wMm: number, hMm: number, size: FormatSpec["size"]): FormatSpec => {
  const w = wMm * MM, h = hMm * MM, pageW = 210 * MM, pageH = 297 * MM;
  return { pageW, pageH, cols, rows, w, h, mx: (pageW - cols * w) / 2, my: (pageH - rows * h) / 2, size };
};
const roll = (wMm: number, hMm: number, size: FormatSpec["size"]): FormatSpec => ({ pageW: wMm * MM, pageH: hMm * MM, cols: 1, rows: 1, w: wMm * MM, h: hMm * MM, mx: 0, my: 0, size });
export const FORMATS: Record<LabelFormat, FormatSpec> = {
  A4_21: a4(3, 7, 70, 42.3, "S"),
  A4_12: a4(2, 6, 105, 49.5, "M"),
  A4_4: a4(2, 2, 105, 148.5, "L"),
  STRIP_27: a4(3, 9, 70, 33, "S"),
  "ROLL_58x40": roll(58, 40, "S"),
  "ROLL_62x29": roll(62, 29, "S"),
  "ROLL_40x30": roll(40, 30, "S"),
};

// ── the shop's own size ─────────────────────────────────────────────────────

/** A size the shop sets itself (mm): on A4 sheets (as many as fit; margins and gaps for sticker sheets) or a roll. */
export type CustomSize = { paper: "A4" | "ROLL"; w: number; h: number; top: number; left: number; gapX: number; gapY: number };
export const CUSTOM_DEFAULT: CustomSize = { paper: "A4", w: 70, h: 37, top: 0, left: 0, gapX: 0, gapY: 0 };
export const CUSTOM_LIMITS = { w: [25, 200], h: [15, 287], margin: [0, 60], gap: [0, 30] } as const;
const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : d; };
export function cleanCustom(v: Partial<CustomSize> | null | undefined): CustomSize {
  const s = v ?? {}, d = CUSTOM_DEFAULT, L = CUSTOM_LIMITS;
  return {
    paper: s.paper === "ROLL" ? "ROLL" : "A4", w: clamp(s.w, L.w, d.w), h: clamp(s.h, L.h, d.h),
    top: clamp(s.top, L.margin, 0), left: clamp(s.left, L.margin, 0), gapX: clamp(s.gapX, L.gap, 0), gapY: clamp(s.gapY, L.gap, 0),
  };
}
/** The type sizes for a label of this size. */
export function sizeClass(wMm: number, hMm: number): FormatSpec["size"] {
  if (wMm >= 90 && hMm >= 100) return "L";
  if (wMm >= 90 && hMm >= 45) return "M";
  return "S";
}
/** The page layout for the shop's size; null when not even one label fits on A4. */
export function customFormat(raw: Partial<CustomSize>): FormatSpec | null {
  const c = cleanCustom(raw);
  const size = sizeClass(c.w, c.h);
  if (c.paper === "ROLL") return roll(c.w, c.h, size);
  const pageW = 210 * MM, pageH = 297 * MM, w = c.w * MM, h = c.h * MM, gx = c.gapX * MM, gy = c.gapY * MM;
  // left/top 0 = centre the labels on the page; otherwise the sticker sheet's margins
  const fit = (page: number, margin: number, len: number, gap: number) => Math.floor((page - (margin > 0 ? 2 * margin : 0) + gap + 0.01) / (len + gap));
  const cols = fit(pageW, c.left * MM, w, gx), rows = fit(pageH, c.top * MM, h, gy);
  if (cols < 1 || rows < 1) return null;
  const usedW = cols * w + (cols - 1) * gx, usedH = rows * h + (rows - 1) * gy;
  return { pageW, pageH, cols, rows, w, h, gx, gy, size, mx: c.left > 0 ? c.left * MM : (pageW - usedW) / 2, my: c.top > 0 ? c.top * MM : (pageH - usedH) / 2 };
}

/** What a printed label shows (the shop ticks; brand / origin / QR only where FIRINGI allows). */
export type LabelFields = { brand: boolean; origin: boolean; code: "BARCODE" | "QR" | "NONE"; unitPrice: boolean; shopName: boolean; date: boolean };
export const DEFAULT_FIELDS: LabelFields = { brand: true, origin: false, code: "BARCODE", unitPrice: true, shopName: false, date: true };

/** Rounding of a price from a margin: none (cents), or ending in 9 (0.79, 1.49 …). */
export type Rounding = "CENT" | "NINE";

/** Selling price incl. VAT per item from today's cost per item (excl. VAT), a margin % and VAT %. */
export function priceFromMargin(costNet: Decimal.Value, marginPct: Decimal.Value, vatRate: Decimal.Value, rounding: Rounding = "NINE") {
  const raw = new Decimal(costNet).mul(new Decimal(marginPct).div(100).plus(1)).mul(new Decimal(vatRate).div(100).plus(1));
  if (rounding === "CENT") return raw.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  // up to the next price ending in 9 cents (x.x9)
  const cents = raw.mul(100).ceil();
  const up = cents.plus((9 - cents.mod(10).toNumber() + 10) % 10);
  return up.div(100);
}

/** Margin % the price gives on the cost (both per item; price incl. VAT). */
export function marginOf(priceGross: Decimal.Value, costNet: Decimal.Value, vatRate: Decimal.Value) {
  const net = new Decimal(priceGross).div(new Decimal(vatRate).div(100).plus(1));
  const cost = new Decimal(costNet);
  return cost.isZero() ? null : net.div(cost).minus(1).mul(100).toDecimalPlaces(1);
}

/** Net content of one item read from its name: "33cl" → 0.33 L, "1,5L" → 1.5 L, "2kg" → 2 KG, "500 g" → 0.5 KG. */
export function contentFromName(name: string): { content: number; unit: "KG" | "L" } | null {
  const m = name.toLowerCase().replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(kg|g|gr|l|lt|cl|ml)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0)) return null;
  switch (m[2]) {
    case "kg": return { content: n, unit: "KG" };
    case "g": case "gr": return { content: n / 1000, unit: "KG" };
    case "l": case "lt": return { content: n, unit: "L" };
    case "cl": return { content: n / 100, unit: "L" };
    case "ml": return { content: n / 1000, unit: "L" };
  }
  return null;
}

/** Unit price (per kg / per litre) incl. VAT, or null when there is no content. */
export function unitPrice(priceGross: Decimal.Value, content: Decimal.Value | null | undefined, unit: string | null | undefined) {
  if (!content || (unit !== "KG" && unit !== "L")) return null;
  const c = new Decimal(content);
  return c.gt(0) ? new Decimal(priceGross).div(c).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null;
}

/** The price a label shows now (the promo while it runs). */
export function shownPrice(l: { priceGross: Decimal.Value; promoPrice?: Decimal.Value | null; promoUntil?: Date | null }, now = new Date()) {
  const promo = l.promoPrice != null && (!l.promoUntil || l.promoUntil >= now) ? new Decimal(l.promoPrice) : null;
  return { price: promo ?? new Decimal(l.priceGross), promo: !!promo, was: promo ? new Decimal(l.priceGross) : null };
}

/** Does the label need printing again? (never printed, or the price / promo changed since) */
export function needsPrint(l: { priceGross: Decimal.Value; promoPrice?: Decimal.Value | null; promoUntil?: Date | null; printedPrice?: Decimal.Value | null; printedPromo?: Decimal.Value | null; printedAt?: Date | null }, now = new Date()) {
  if (!l.printedAt || l.printedPrice == null) return true;
  const s = shownPrice(l, now);
  const printedPromo = l.printedPromo == null ? null : new Decimal(l.printedPromo);
  if (!new Decimal(l.printedPrice).eq(l.priceGross)) return true;
  if (s.promo !== !!printedPromo) return true;
  return s.promo && printedPromo ? !printedPromo.eq(s.price) : false;
}

export type ShelfLabelSettings = {
  enabled: boolean;
  /** who may use it */
  buyers: { CUSTOMER: boolean; WHOLESALER: boolean };
  /** what shops may put on labels */
  allowBrand: boolean; allowOrigin: boolean; allowQr: boolean;
  /** shops may save the selling price into their FIRINGI till */
  allowPosSync: boolean;
  /** shops may set their own label size (sticker sheets, other label printers) */
  allowCustomSize: boolean;
  offCountries: string[];
  companies: Record<string, "ON" | "OFF">;
};
export const SL_DEFAULTS: ShelfLabelSettings = { enabled: true, buyers: { CUSTOMER: true, WHOLESALER: true }, allowBrand: true, allowOrigin: false, allowQr: true, allowPosSync: true, allowCustomSize: true, offCountries: [], companies: {} };
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
export function mergeSl(v: Partial<ShelfLabelSettings> | null | undefined): ShelfLabelSettings {
  const s = v ?? {}, d = SL_DEFAULTS;
  return {
    enabled: bool(s.enabled, d.enabled),
    buyers: { CUSTOMER: bool(s.buyers?.CUSTOMER, true), WHOLESALER: bool(s.buyers?.WHOLESALER, true) },
    allowBrand: bool(s.allowBrand, d.allowBrand), allowOrigin: bool(s.allowOrigin, d.allowOrigin), allowQr: bool(s.allowQr, d.allowQr), allowPosSync: bool(s.allowPosSync, d.allowPosSync), allowCustomSize: bool(s.allowCustomSize, d.allowCustomSize),
    offCountries: [...new Set((Array.isArray(s.offCountries) ? s.offCountries : []).filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c)).map((c) => c.toUpperCase()))],
    companies: Object.fromEntries(Object.entries(s.companies ?? {}).filter(([k, x]) => k.length < 60 && (x === "ON" || x === "OFF"))) as Record<string, "ON" | "OFF">,
  };
}
export function slOn(s: ShelfLabelSettings, c: { id: string; type: string; countryCode: string }) {
  if (!s.enabled || (c.type !== "CUSTOMER" && c.type !== "WHOLESALER")) return false;
  const o = s.companies[c.id];
  if (o) return o === "ON";
  if (s.offCountries.includes(c.countryCode.toUpperCase())) return false;
  return s.buyers[c.type as "CUSTOMER" | "WHOLESALER"];
}
/** The fields a shop asked for, limited to what FIRINGI allows. */
export function allowedFields(f: LabelFields, s: ShelfLabelSettings): LabelFields {
  return { ...f, brand: f.brand && s.allowBrand, origin: f.origin && s.allowOrigin, code: f.code === "QR" && !s.allowQr ? "BARCODE" : f.code };
}
