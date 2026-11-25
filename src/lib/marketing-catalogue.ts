/**
 * Marketing catalogues — pure rules shared by server and pages: what FIRINGI can choose for a catalogue (who it is for:
 * all wholesalers, some wholesalers, delivery zones or districts; how products are picked; layout; what each product
 * shows: price, barcode, quantities, supplier) and the AI's answer when it picks the products.
 */
import { z } from "zod";

export const MC_SCOPES = ["ALL", "WHOLESALER", "ZONE", "DISTRICT"] as const;
export type McScope = (typeof MC_SCOPES)[number];
export const MC_LAYOUTS = ["GRID4", "GRID6", "GRID9", "LIST"] as const;
export type McLayout = (typeof MC_LAYOUTS)[number];
export const GRID_COLS: Record<McLayout, number> = { GRID4: 2, GRID6: 2, GRID9: 3, LIST: 1 };

export type McOptions = {
  /** NONE: no prices; NET: excl. VAT; GROSS: incl. VAT */
  price: "NONE" | "NET" | "GROSS";
  /** the barcode (pack and single item) */
  barcode: boolean;
  /** the pack ("Case 24 × 33 cl") and the minimum order / step */
  qty: boolean;
  /** who sells it: not shown, the wholesaler's name, or "FIRINGI <area>" */
  supplier: "NONE" | "NAME" | "AREA";
  /** a QR code per product that opens it in the shop */
  qr: boolean;
};
export const MC_DEFAULT_OPTIONS: McOptions = { price: "NET", barcode: true, qty: true, supplier: "NONE", qr: true };
export function mergeOptions(v: Partial<McOptions> | null | undefined): McOptions {
  const s = v ?? {}, d = MC_DEFAULT_OPTIONS;
  return {
    price: s.price === "NONE" || s.price === "GROSS" || s.price === "NET" ? s.price : d.price,
    barcode: typeof s.barcode === "boolean" ? s.barcode : d.barcode,
    qty: typeof s.qty === "boolean" ? s.qty : d.qty,
    supplier: s.supplier === "NAME" || s.supplier === "AREA" || s.supplier === "NONE" ? s.supplier : d.supplier,
    qr: typeof s.qr === "boolean" ? s.qr : d.qr,
  };
}

export type McFilters = {
  categoryIds?: string[];
  brandIds?: string[];
  /** words / barcode */
  q?: string;
  /** best sellers first (last 90 days) */
  bestSellers?: boolean;
  /** only products with a photo */
  withImages?: boolean;
  /** at most this many products (1–200) */
  max?: number;
};
export function mergeFilters(v: Partial<McFilters> | null | undefined): McFilters {
  const s = v ?? {};
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string" && i.length < 40).slice(0, 100) : []);
  const max = Number(s.max);
  return {
    categoryIds: ids(s.categoryIds), brandIds: ids(s.brandIds), q: typeof s.q === "string" ? s.q.trim().slice(0, 120) : "",
    bestSellers: s.bestSellers !== false, withImages: !!s.withImages, max: Number.isFinite(max) ? Math.min(200, Math.max(1, Math.round(max))) : 24,
  };
}

/** One product in the catalogue, in order; a section title starts a new section. */
export type McItem = { offerId: string; section?: string | null };
export function cleanItems(v: unknown): McItem[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: McItem[] = [];
  for (const x of v) {
    const id = typeof x === "string" ? x : (x as McItem)?.offerId;
    if (typeof id !== "string" || !id || id.length > 40 || seen.has(id)) continue;
    seen.add(id);
    const sec = typeof x === "object" && x && typeof (x as McItem).section === "string" ? (x as McItem).section!.trim().slice(0, 80) : null;
    out.push({ offerId: id, section: sec || null });
    if (out.length >= 200) break;
  }
  return out;
}

/** Height (pt) of a product row and a section header on an A4 page, per layout; the space for them per page. */
export const ROW_H: Record<McLayout, number> = { GRID4: 320, GRID6: 205, GRID9: 205, LIST: 52 };
/** extra height when products carry a drawn barcode */
export const BARS_H: Record<McLayout, number> = { GRID4: 40, GRID6: 40, GRID9: 36, LIST: 18 };
export const HEADER_H = 28;
export const PAGE_BUDGET = 765;

export type Block<T> = { kind: "header"; title: string } | { kind: "row"; items: T[] };
/**
 * Lay the products out on pages: sections in order, a header where a section starts, rows of `cols` products; a page
 * takes rows until it is full (a header never ends a page on its own).
 */
export function packPages<T extends { section?: string | null }>(items: T[], cols: number, rowH: number, headerH = HEADER_H, budget = PAGE_BUDGET): Block<T>[][] {
  const blocks: Block<T>[] = [];
  let row: T[] = [];
  const flush = () => { if (row.length) { blocks.push({ kind: "row", items: row }); row = []; } };
  for (const it of items) {
    if (it.section) { flush(); blocks.push({ kind: "header", title: it.section }); }
    row.push(it);
    if (row.length >= cols) flush();
  }
  flush();
  const pages: Block<T>[][] = [];
  let cur: Block<T>[] = [], used = 0;
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const h = b.kind === "header" ? headerH + rowH : rowH; // keep a header with its first row
    if (cur.length && used + h > budget) { pages.push(cur); cur = []; used = 0; }
    cur.push(b);
    used += b.kind === "header" ? headerH : rowH;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/** What the AI returns when it builds a catalogue from a brief (validated; ids are checked against the candidates). */
export const AiCatalogue = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(160).default(""),
  intro: z.string().max(600).default(""),
  sections: z.array(z.object({ title: z.string().max(80).default(""), offerIds: z.array(z.string().max(40)).max(200) })).min(1).max(20),
});
export type AiCatalogue = z.infer<typeof AiCatalogue>;

/** The texts of a catalogue the AI translates into another language. */
export const AiTranslation = z.object({ title: z.string().min(1).max(120), subtitle: z.string().max(160).default(""), intro: z.string().max(600).default(""), sections: z.array(z.string().max(80)).max(20).default([]) });

// ── scannable barcodes (EAN-13 / EAN-8 / UPC-A) ─────────────────────────────

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
/** R = L inverted; G = R reversed */
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => [...p].reverse().join(""));
/** first digit of an EAN-13 → which of the left six digits use the G (even) set */
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

const checkOk = (code: string) => {
  const d = code.split("").map(Number);
  const c = d.pop()!;
  return (10 - (d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10 === c;
};

/**
 * The bars of a barcode as modules ("1" black, "0" white): EAN-13 (95), UPC-A (as EAN-13 with a leading 0),
 * EAN-8 (67), GTIN-14 with a leading 0. Null for anything else (e.g. a case code ITF-14) or a wrong check digit.
 */
export function eanModules(raw: string | null | undefined): { modules: string; digits: string } | null {
  let code = (raw ?? "").replace(/\s/g, "");
  if (/^0\d{13}$/.test(code)) code = code.slice(1);
  if (/^\d{12}$/.test(code)) code = `0${code}`;
  if (/^\d{13}$/.test(code) && checkOk(code)) {
    const p = PARITY[Number(code[0])];
    const left = code.slice(1, 7).split("").map((x, i) => (p[i] === "L" ? L : G)[Number(x)]).join("");
    const right = code.slice(7).split("").map((x) => R[Number(x)]).join("");
    return { modules: `101${left}01010${right}101`, digits: code };
  }
  if (/^\d{8}$/.test(code) && checkOk(code)) {
    const left = code.slice(0, 4).split("").map((x) => L[Number(x)]).join("");
    const right = code.slice(4).split("").map((x) => R[Number(x)]).join("");
    return { modules: `101${left}01010${right}101`, digits: code };
  }
  return null;
}

/** Runs of black modules [start, width] — one rectangle per bar. */
export function barRuns(modules: string): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== "1") continue;
    let j = i;
    while (modules[j + 1] === "1") j++;
    out.push([i, j - i + 1]);
    i = j;
  }
  return out;
}

/** The barcode to print for a product: the pack's if it can be drawn, else the single item's. */
export function printableBarcode(packGtin: string | null, unitGtin: string | null) {
  return eanModules(packGtin) ?? eanModules(unitGtin);
}
