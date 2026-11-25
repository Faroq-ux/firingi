/**
 * Add a product by barcode with AI — pure rules shared by server and pages: FIRINGI's switches (on/off, which sellers,
 * each part, countries left out, a company override), barcode checks, reading an Open Food Facts record and the shape
 * of the product draft the supplier checks before proposing it.
 */
import { z } from "zod";
import { ALLERGENS, DIETS, type Allergen, type Diet } from "@/lib/food";

export const BA_PARTS = ["lookup", "ai", "photos"] as const;
export type BaPart = (typeof BA_PARTS)[number];
export type BarcodeAiSettings = {
  enabled: boolean;
  /** which suppliers may use it */
  sellers: { DISTRIBUTOR: boolean; WHOLESALER: boolean };
  /** lookup: Open Food Facts; ai: the AI fills the form; photos: the AI reads photos of the package */
  parts: Record<BaPart, boolean>;
  /** suppliers in these countries can't use it (unless switched on one by one) */
  offCountries: string[];
  /** one company switched on ("ON", even in a country left out) or off ("OFF") */
  companies: Record<string, "ON" | "OFF">;
  /** lookups per supplier per hour */
  hourlyLimit: number;
};
export const DEFAULT_BA: BarcodeAiSettings = {
  enabled: true, sellers: { DISTRIBUTOR: true, WHOLESALER: true },
  parts: { lookup: true, ai: true, photos: true }, offCountries: [], companies: {}, hourlyLimit: 60,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
export function mergeBa(v: Partial<BarcodeAiSettings> | null | undefined): BarcodeAiSettings {
  const s = (v ?? {}) as Partial<BarcodeAiSettings>, d = DEFAULT_BA;
  const lim = Number(s.hourlyLimit);
  return {
    enabled: bool(s.enabled, d.enabled),
    sellers: { DISTRIBUTOR: bool(s.sellers?.DISTRIBUTOR, true), WHOLESALER: bool(s.sellers?.WHOLESALER, true) },
    parts: Object.fromEntries(BA_PARTS.map((p) => [p, bool(s.parts?.[p], d.parts[p])])) as Record<BaPart, boolean>,
    offCountries: [...new Set((Array.isArray(s.offCountries) ? s.offCountries : []).filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c)).map((c) => c.toUpperCase()))],
    companies: Object.fromEntries(Object.entries(s.companies ?? {}).filter(([k, x]) => k.length < 60 && (x === "ON" || x === "OFF"))) as Record<string, "ON" | "OFF">,
    hourlyLimit: Number.isFinite(lim) ? Math.min(1000, Math.max(1, Math.round(lim))) : d.hourlyLimit,
  };
}

/** May this supplier add products by barcode with AI? A company override wins over the country and seller type. */
export function barcodeAiOn(s: BarcodeAiSettings, c: { id: string; type: string; countryCode?: string | null }) {
  if (!s.enabled || !(c.type === "DISTRIBUTOR" || c.type === "WHOLESALER")) return false;
  const o = s.companies[c.id];
  if (o === "OFF") return false;
  if (o === "ON") return true;
  if (c.countryCode && s.offCountries.includes(c.countryCode.toUpperCase())) return false;
  return s.sellers[c.type as "DISTRIBUTOR" | "WHOLESALER"];
}

/** EAN-8, UPC-A (12), EAN-13 or GTIN-14 with a correct check digit. */
export function validGtin(raw: string) {
  const code = raw.replace(/\s/g, "");
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return null;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? (code.length === 14 && code[0] === "0" ? code.slice(1) : code) : null;
}

/** Wholesale: a case / outer carton code (GTIN-14, first digit 1–8) → the barcode of the single item inside (GTIN-13). */
export function innerGtin(code: string) {
  if (!/^[1-8]\d{13}$/.test(code)) return null;
  const body = code.slice(1, 13).split("").map(Number);
  const sum = [...body].reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return code.slice(1, 13) + String((10 - (sum % 10)) % 10);
}

// ── Open Food Facts ──────────────────────────────────────────────────────────

export const OFF_FIELDS = [
  "code", "product_name", "product_name_en", "product_name_pt", "product_name_es", "product_name_fr", "product_name_de", "product_name_it",
  "generic_name", "brands", "quantity", "product_quantity", "product_quantity_unit", "packaging", "categories_tags", "categories",
  "allergens_tags", "traces_tags", "labels_tags", "ingredients_text", "ingredients_text_en", "ingredients_text_pt", "countries_tags", "image_front_url",
] as const;
export type OffProduct = Partial<Record<(typeof OFF_FIELDS)[number], unknown>>;

const OFF_ALLERGEN: Record<string, Allergen> = {
  "en:gluten": "GLUTEN", "en:crustaceans": "CRUSTACEANS", "en:eggs": "EGGS", "en:fish": "FISH", "en:peanuts": "PEANUTS", "en:soybeans": "SOY",
  "en:milk": "MILK", "en:nuts": "NUTS", "en:celery": "CELERY", "en:mustard": "MUSTARD", "en:sesame-seeds": "SESAME",
  "en:sulphur-dioxide-and-sulphites": "SULPHITES", "en:lupin": "LUPIN", "en:molluscs": "MOLLUSCS",
};
const OFF_DIET: Record<string, Diet> = {
  "en:vegan": "VEGAN", "en:vegetarian": "VEGETARIAN", "en:halal": "HALAL", "en:kosher": "KOSHER", "en:no-gluten": "GLUTEN_FREE", "en:gluten-free": "GLUTEN_FREE",
  "en:no-lactose": "LACTOSE_FREE", "en:lactose-free": "LACTOSE_FREE", "en:organic": "ORGANIC", "en:eu-organic": "ORGANIC",
};
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 2000) : "");

/** What an Open Food Facts record tells about a product, in FIRINGI's terms. */
export type OffFacts = {
  names: Record<string, string>; genericName: string; brand: string; quantity: string; packaging: string;
  categories: string[]; contain: Allergen[]; mayContain: Allergen[]; diets: Diet[]; ingredients: Record<string, string>; imageUrl: string | null;
};
export function offFacts(p: OffProduct): OffFacts {
  const names: Record<string, string> = {};
  for (const l of ["en", "pt", "es", "fr", "de", "it"]) { const n = text(p[`product_name_${l}` as keyof OffProduct]); if (n) names[l] = n; }
  const any = text(p.product_name);
  if (any && !Object.values(names).includes(any)) names.xx = any;
  const ingredients: Record<string, string> = {};
  for (const [k, l] of [["ingredients_text_en", "en"], ["ingredients_text_pt", "pt"]] as const) { const t = text(p[k]); if (t) ingredients[l] = t; }
  if (!Object.keys(ingredients).length && text(p.ingredients_text)) ingredients.xx = text(p.ingredients_text);
  const contain = [...new Set(strs(p.allergens_tags).map((t) => OFF_ALLERGEN[t]).filter(Boolean))];
  return {
    names, genericName: text(p.generic_name), brand: text(p.brands).split(",")[0]?.trim() ?? "", quantity: text(p.quantity), packaging: text(p.packaging),
    categories: strs(p.categories_tags).slice(0, 12), contain,
    mayContain: [...new Set(strs(p.traces_tags).map((t) => OFF_ALLERGEN[t]).filter((a) => a && !contain.includes(a)))],
    diets: [...new Set(strs(p.labels_tags).map((t) => OFF_DIET[t]).filter(Boolean))],
    ingredients, imageUrl: typeof p.image_front_url === "string" && p.image_front_url.startsWith("https://") ? p.image_front_url : null,
  };
}

/** "6 x 33 cl" → 6 packs of "33 cl"; "1,5 L" → 1 × "1.5 l"; "" → 1 × "". */
export function parseQuantity(q: string) {
  const s = q.toLowerCase().replace(",", ".").trim();
  const m = s.match(/^(\d+)\s*[x×*]\s*(.+)$/);
  return m ? { count: Math.max(1, Math.min(1000, Number(m[1]))), size: m[2].trim() } : { count: 1, size: s };
}
/** A first guess at the unit for the size printed: litres → L, kilos → KG, otherwise a unit. */
export function unitFor(size: string) {
  if (/\b(\d+(\.\d+)?)\s*(l|cl|ml|litre|liter)s?\b/.test(size)) return "L";
  if (/\b(\d+(\.\d+)?)\s*(kg|g|gr|grams?)\b/.test(size)) return "KG";
  return "UN";
}

// ── the draft the supplier checks ────────────────────────────────────────────

/** The proposal form, filled in. Ids are FIRINGI's own (category, VAT category, brand, unit) or null. */
export type ProductDraft = {
  gtin: string;
  /** the single item's barcode when the scanned one is on the case (wholesale) */
  unitGtin: string | null;
  /** the scanned barcode is on the single item (unit) or on the case / pack */
  barcodeOn: "UNIT" | "PACK";
  nameEn: string; namePt: string;
  brandId: string | null; brandName: string;
  categoryId: string | null; taxCategoryId: string | null; restriction: "ALCOHOL" | "TOBACCO" | null;
  uomCode: string; unitsPerPack: number; packName: string;
  descriptionEn: string; descriptionPt: string;
  contain: Allergen[]; mayContain: Allergen[]; diets: Diet[]; ingredients: Record<string, string>;
  /** what the AI wasn't sure about */
  notes: string;
  source: "OFF" | "OFF_AI" | "PHOTOS_AI" | "OFF_PHOTOS_AI";
  simulated: boolean;
};

/** What the AI returns (validated); the server turns it into a ProductDraft. */
export const AiDraft = z.object({
  barcodeOn: z.enum(["UNIT", "PACK"]).default("UNIT"),
  nameEn: z.string().min(1).max(200),
  namePt: z.string().max(200).default(""),
  brandName: z.string().max(100).default(""),
  categoryId: z.string().max(40).nullable().default(null),
  taxCategoryCode: z.string().max(40).nullable().default(null),
  restriction: z.enum(["ALCOHOL", "TOBACCO"]).nullable().default(null),
  uomCode: z.string().max(10).default("UN"),
  unitsPerPack: z.number().int().min(1).max(10000).default(1),
  packName: z.string().max(100).default(""),
  descriptionEn: z.string().max(1000).default(""),
  descriptionPt: z.string().max(1000).default(""),
  contain: z.array(z.enum(ALLERGENS)).default([]),
  mayContain: z.array(z.enum(ALLERGENS)).default([]),
  diets: z.array(z.enum(DIETS)).default([]),
  ingredients: z.string().max(3000).default(""),
  ingredientsLanguage: z.string().max(5).default(""),
  notes: z.string().max(600).default(""),
});
export type AiDraft = z.infer<typeof AiDraft>;
