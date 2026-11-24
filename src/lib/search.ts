/**
 * Smart product search — Phase 72. Pure rules shared by server and pages: text normalising (lower case, no accents),
 * search words, the filters a search can carry, and the shape of what the AI understood from a query.
 *
 * Matching itself runs in PostgreSQL (pg_trgm + unaccent): every search word — or one of its synonyms — must appear in
 * the product's search text, exactly or with a small typo; results are ranked by how well they match.
 */
import { z } from "zod";
import { ALLERGENS, DIETS } from "@/lib/food";

export type SearchSettings = {
  /** typo-tolerant, accent-insensitive matching (off: plain "contains") */
  fuzzy: boolean;
  /** how close a misspelt word must be (0.3 loose … 0.8 strict) */
  typo: number;
  /** the AI reads the query: product words in other languages, synonyms and filters ("gluten free under 5 €") */
  ai: boolean;
  /** synonyms FIRINGI keeps (and the AI adds) are used for every search, also without AI */
  synonyms: boolean;
  /** filters and sorting on the search page */
  filters: boolean;
};
export const SEARCH_DEFAULTS: SearchSettings = { fuzzy: true, typo: 0.5, ai: true, synonyms: true, filters: true };

export function cleanSearchSettings(v: Partial<SearchSettings>): SearchSettings {
  const typo = Number(v.typo ?? SEARCH_DEFAULTS.typo);
  return {
    fuzzy: v.fuzzy ?? SEARCH_DEFAULTS.fuzzy,
    typo: Number.isFinite(typo) ? Math.min(0.8, Math.max(0.3, Math.round(typo * 100) / 100)) : SEARCH_DEFAULTS.typo,
    ai: v.ai ?? SEARCH_DEFAULTS.ai,
    synonyms: v.synonyms ?? SEARCH_DEFAULTS.synonyms,
    filters: v.filters ?? SEARCH_DEFAULTS.filters,
  };
}

/** Lower case, accents off ("Açúcar" → "acucar"), punctuation to spaces (sizes like "1.5l" / "33cl" kept). */
export function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ø/g, "o").replace(/ł/g, "l").replace(/[đð]/g, "d")
    .replace(/ı/g, "i").replace(/þ/g, "th").replace(/ħ/g, "h").replace(/ŧ/g, "t").replace(/ŀ/g, "l")
    .replace(/(\d)[.,](\d)/g, "$1.$2").replace(/[^a-z0-9.]+/g, " ").replace(/(^|\s)\.+|\.+(\s|$)/g, " ").replace(/\s+/g, " ").trim();
}

/** Little words that never narrow a product search, in the main languages. */
const STOP = new Set(("a an and the for with of in to per on at by from " +
  "o os as um uma uns umas de do da dos das e em para com por no na nos nas ao " +
  "el la los las un una unos unas y en para con por del al " +
  "le les un une des et en pour avec du au aux " +
  "der die das ein eine und mit fur fuer von zu im am " +
  "il lo gli i un una e per con di da del della in " +
  "het een en voor met van te op").split(" "));

/** The words of a query that must match (max 8). */
export function searchWords(q: string) {
  return [...new Set(normalize(q).split(" ").filter((w) => w.length >= 2 && !STOP.has(w)))].slice(0, 8);
}

export const SORTS = ["relevance", "price", "rating", "distance"] as const;
export type Sort = (typeof SORTS)[number];

/** What the search page can filter by (URL parameters). */
export type SearchFilters = {
  cat: string | null; vendor: string | null; max: number | null; deal: boolean;
  free: string[]; diet: string | null; stars: number | null; sort: Sort;
};
export const NO_FILTERS: SearchFilters = { cat: null, vendor: null, max: null, deal: false, free: [], diet: null, stars: null, sort: "relevance" };

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export function parseFilters(sp: Sp): SearchFilters {
  const max = Number(one(sp.max).replace(",", "."));
  const stars = Number(one(sp.stars));
  const free = [sp.free ?? []].flat().flatMap((x) => x.split(",")).filter((x) => (ALLERGENS as readonly string[]).includes(x));
  const diet = one(sp.diet);
  const sort = one(sp.sort);
  const id = (v: string) => (/^[a-z0-9]{8,40}$/i.test(v) ? v : null);
  return {
    cat: id(one(sp.cat)), vendor: id(one(sp.vendor)),
    max: Number.isFinite(max) && max > 0 ? Math.round(max * 100) / 100 : null,
    deal: one(sp.deal) === "1",
    free: [...new Set(free)], diet: (DIETS as readonly string[]).includes(diet) ? diet : null,
    stars: stars >= 1 && stars <= 5 ? Math.round(stars) : null,
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : "relevance",
  };
}

/** Filters back to URL parameters (only those set). */
export function filterParams(f: Partial<SearchFilters> & { q?: string; ai?: string }) {
  const p: Record<string, string> = {};
  if (f.q) p.q = f.q;
  if (f.cat) p.cat = f.cat;
  if (f.vendor) p.vendor = f.vendor;
  if (f.max) p.max = String(f.max);
  if (f.deal) p.deal = "1";
  if (f.free?.length) p.free = f.free.join(",");
  if (f.diet) p.diet = f.diet;
  if (f.stars) p.stars = String(f.stars);
  if (f.sort && f.sort !== "relevance") p.sort = f.sort;
  if (f.ai) p.ai = f.ai;
  return p;
}

/** What the AI understood from a query (validated before use). */
export const Understanding = z.object({
  /** product words, each with alternatives: translations into other EU languages, synonyms, singular/plural */
  words: z.array(z.object({ word: z.string().min(1).max(40), alternatives: z.array(z.string().min(1).max(40)).max(30) })).max(8),
  free: z.array(z.enum(ALLERGENS)).max(14).default([]),
  diet: z.enum(DIETS).nullable().default(null),
  maxPrice: z.number().positive().max(100000).nullable().default(null),
  onDeal: z.boolean().default(false),
  sort: z.enum(SORTS).nullable().default(null),
  /** a better spelling of the whole query when it was clearly misspelt ("did you mean") */
  corrected: z.string().max(120).nullable().default(null),
});
export type Understanding = z.infer<typeof Understanding>;

/** Does a query carry more than product words (prices, diets, "cheapest" …)? Then reading it with AI pays off most. */
export function looksLikeSentence(q: string) {
  const w = normalize(q).split(" ").filter(Boolean);
  return w.length >= 3 || /\d/.test(q) || /[€$£]/.test(q);
}

/** The alternatives of a word, cleaned: normalised, no duplicates, not the word itself, max 20. */
export function cleanAlternatives(word: string, alts: string[]) {
  const w = normalize(word);
  return [...new Set(alts.map(normalize).filter((a) => a.length >= 2 && a !== w && a.length <= 40))].slice(0, 20);
}
