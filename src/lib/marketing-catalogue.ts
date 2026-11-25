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
