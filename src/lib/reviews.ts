/**
 * Phase 53 — product reviews & questions: pure rules (settings, the automatic filter, rating totals, common complaints,
 * monthly trend). No database; unit-tested.
 */

export const REVIEW_BUYER_TYPES = ["CUSTOMER", "WHOLESALER"] as const;
export const REVIEW_SELLER_TYPES = ["WHOLESALER", "DISTRIBUTOR"] as const;
export const REVIEW_PARTS = ["reviews", "details", "photos", "helpful", "questions", "buyerAnswers", "replies", "insights", "reminders", "searchStars", "aiSummary"] as const;
export const DETAILS = ["quality", "value", "packaging", "freshness"] as const;
export const REPORT_REASONS = ["CONTACT", "OFFENSIVE", "FALSE", "NOT_ABOUT_PRODUCT", "SPAM", "OTHER"] as const;
export const HOLD_REASONS = ["CONTACT", "LINK", "INSULT", "COMPETITOR", "WORD", "REPORTS"] as const;
export const THEMES = ["DAMAGED", "EXPIRY", "TASTE", "SIZE", "PACKAGING", "PRICE", "TEMPERATURE", "MISSING"] as const;

export type BuyerType = (typeof REVIEW_BUYER_TYPES)[number];
export type SellerType = (typeof REVIEW_SELLER_TYPES)[number];
export type ReviewPart = (typeof REVIEW_PARTS)[number];
export type Detail = (typeof DETAILS)[number];
export type HoldReason = (typeof HOLD_REASONS)[number];
export type Theme = (typeof THEMES)[number];

export type ReviewSettings = {
  enabled: boolean;
  buyers: Record<BuyerType, boolean>; // who may write reviews, ask and answer
  sellers: Record<SellerType, boolean>; // whose products show reviews
  parts: Record<ReviewPart, boolean>;
  maxPhotos: number; // 0–3
  maxChars: number; // 200–4000
  editDays: number; // a review can be edited this many days (0 = always)
  filter: { contacts: boolean; links: boolean; insults: boolean; competitors: string[]; words: string[] };
  autoHoldReports: number; // reports that hold a post for FIRINGI (0 = never)
  reminder: { afterDays: number };
  aiMinReviews: number;
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  enabled: true,
  buyers: { CUSTOMER: true, WHOLESALER: true },
  sellers: { WHOLESALER: true, DISTRIBUTOR: true },
  parts: { reviews: true, details: true, photos: true, helpful: true, questions: true, buyerAnswers: true, replies: true, insights: true, reminders: true, searchStars: true, aiSummary: true },
  maxPhotos: 3,
  maxChars: 2000,
  editDays: 0,
  filter: { contacts: true, links: true, insults: true, competitors: [], words: [] },
  autoHoldReports: 3,
  reminder: { afterDays: 3 },
  aiMinReviews: 3,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const flags = <K extends string>(keys: readonly K[], v: unknown, d: Record<K, boolean>) =>
  Object.fromEntries(keys.map((k) => [k, bool((v as Record<string, unknown> | null)?.[k], d[k])])) as Record<K, boolean>;
const words = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length >= 2).map((x) => x.slice(0, 60)))].slice(0, 200) : []);

export function mergeReviewSettings(v: Partial<ReviewSettings> | null | undefined): ReviewSettings {
  const d = DEFAULT_REVIEW_SETTINGS;
  const x = (v ?? {}) as Partial<ReviewSettings>;
  const num = (n: unknown, def: number) => (typeof n === "number" && Number.isFinite(n) ? n : def);
  return {
    enabled: bool(x.enabled, d.enabled),
    buyers: flags(REVIEW_BUYER_TYPES, x.buyers, d.buyers),
    sellers: flags(REVIEW_SELLER_TYPES, x.sellers, d.sellers),
    parts: flags(REVIEW_PARTS, x.parts, d.parts),
    maxPhotos: num(x.maxPhotos, d.maxPhotos),
    maxChars: num(x.maxChars, d.maxChars),
    editDays: num(x.editDays, d.editDays),
    filter: {
      contacts: bool(x.filter?.contacts, d.filter.contacts), links: bool(x.filter?.links, d.filter.links), insults: bool(x.filter?.insults, d.filter.insults),
      competitors: words(x.filter?.competitors), words: words(x.filter?.words),
    },
    autoHoldReports: num(x.autoHoldReports, d.autoHoldReports),
    reminder: { afterDays: num(x.reminder?.afterDays, d.reminder.afterDays) },
    aiMinReviews: num(x.aiMinReviews, d.aiMinReviews),
  };
}

/** Validate what FIRINGI saves; throws with a readable message. */
export function cleanReviewSettings(v: ReviewSettings): ReviewSettings {
  const s = mergeReviewSettings(v);
  const int = (n: number, lo: number, hi: number, label: string) => { if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label}: ${lo} to ${hi}.`); };
  int(s.maxPhotos, 0, 3, "Photos per review");
  int(s.maxChars, 200, 4000, "Longest text");
  int(s.editDays, 0, 365, "Days to edit a review");
  int(s.autoHoldReports, 0, 50, "Reports that hold a post");
  int(s.reminder.afterDays, 1, 30, "Reminder after (days)");
  int(s.aiMinReviews, 1, 50, "Reviews before an AI summary");
  return s;
}

// ── the automatic filter ─────────────────────────────────────────────────────

/** Lower case, accents removed, so "Péssimo" matches "pessimo". */
export const fold = (t: string) => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A short list of insults in the main EU languages — FIRINGI adds its own words in the settings. */
const INSULTS = [
  // en
  "idiot", "idiots", "stupid", "moron", "scam", "scammer", "scammers", "crook", "crooks", "thief", "thieves", "fuck", "fucking", "shit", "bastard", "asshole",
  // pt
  "idiota", "idiotas", "estupido", "estupidos", "burro", "burros", "ladrao", "ladroes", "vigarista", "vigaristas", "merda", "caralho", "porra", "filho da puta", "aldrabao", "aldraboes",
  // es
  "imbecil", "gilipollas", "estafador", "estafadores", "mierda", "cabron", "ladron", "ladrones", "hijo de puta",
  // fr
  "connard", "connards", "salaud", "escroc", "escrocs", "voleur", "voleurs", "putain", "merde",
  // de
  "betruger", "arschloch", "scheisse", "scheiße", "idioten", "dieb", "diebe",
  // it
  "truffatore", "truffatori", "ladro", "ladri", "stronzo", "cazzo",
  // nl
  "oplichter", "oplichters", "klootzak", "kut",
];

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;
const SPOKEN_EMAIL = /\b[\p{L}\p{N}._-]{2,}\s*(?:\(|\[)?\s*(?:at|arroba|chez|bei|presso)\s*(?:\)|\])?\s*[\p{L}\p{N}-]{2,}\s*(?:\(|\[)?\s*(?:dot|ponto|punto|point|punkt)\s*(?:\)|\])?\s*[\p{L}]{2,}\b/iu;
const LINK = /\bhttps?:\/\/|\bwww\.|\b[\p{L}\p{N}-]{2,}\.(?:com|net|org|pt|es|fr|de|it|nl|be|at|eu|io|shop|store|info|biz|co)\b/iu;
const SOCIAL = /\b(?:whatsapp|telegram|instagram|facebook|wa\.me|t\.me)\b/i;
const PHONE = /\+?\d[\d\s().\/-]{7,}\d/g;

const hasWord = (text: string, w: string) => {
  const f = fold(w).trim();
  if (!f) return false;
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "u").test(text);
};

/** Why a post must wait for FIRINGI (empty = publish at once). */
export function screen(text: string, f: ReviewSettings["filter"]): HoldReason[] {
  const raw = text ?? "";
  const t = fold(raw);
  const out = new Set<HoldReason>();
  if (f.contacts) {
    if (EMAIL.test(raw) || SPOKEN_EMAIL.test(t) || SOCIAL.test(t)) out.add("CONTACT");
    for (const m of raw.match(PHONE) ?? []) if (m.replace(/\D/g, "").length >= 9) out.add("CONTACT");
  }
  if (f.links && LINK.test(raw.replace(new RegExp(EMAIL.source, "gu"), " "))) out.add("LINK"); // an e-mail address alone is CONTACT, not LINK
  if (f.insults && INSULTS.some((w) => hasWord(t, w))) out.add("INSULT");
  if (f.competitors.some((w) => hasWord(t, w))) out.add("COMPETITOR");
  if (f.words.some((w) => hasWord(t, w))) out.add("WORD");
  return HOLD_REASONS.filter((r) => out.has(r));
}

// ── totals ───────────────────────────────────────────────────────────────────

export type ReviewLite = { stars: number; quality?: number | null; value?: number | null; packaging?: number | null; freshness?: number | null; body?: string | null; createdAt?: Date };
export type RatingStat = { count: number; sum: number; avg: number; dist: number[]; details: Record<Detail, [number, number]> };

export const emptyStat = (): RatingStat => ({ count: 0, sum: 0, avg: 0, dist: [0, 0, 0, 0, 0], details: { quality: [0, 0], value: [0, 0], packaging: [0, 0], freshness: [0, 0] } });
const r2 = (n: number) => Math.round(n * 100) / 100;

export function ratingStat(reviews: ReviewLite[]): RatingStat {
  const s = emptyStat();
  for (const r of reviews) {
    if (!Number.isInteger(r.stars) || r.stars < 1 || r.stars > 5) continue;
    s.count++; s.sum += r.stars; s.dist[r.stars - 1]++;
    for (const d of DETAILS) { const v = r[d]; if (typeof v === "number" && v >= 1 && v <= 5) { s.details[d][0] += v; s.details[d][1]++; } }
  }
  s.avg = s.count ? r2(s.sum / s.count) : 0;
  return s;
}

/** Product-level totals across suppliers (FIRINGI mode, where the supplier is not shown). */
export function combineStats(stats: Pick<RatingStat, "count" | "sum" | "dist" | "details">[]): RatingStat {
  const s = emptyStat();
  for (const x of stats) {
    s.count += x.count; s.sum += x.sum;
    x.dist.forEach((n, i) => { s.dist[i] += n; });
    for (const d of DETAILS) { const v = x.details?.[d]; if (v) { s.details[d][0] += v[0]; s.details[d][1] += v[1]; } }
  }
  s.avg = s.count ? r2(s.sum / s.count) : 0;
  return s;
}

export const detailAvg = (s: RatingStat, d: Detail) => (s.details[d][1] ? r2(s.details[d][0] / s.details[d][1]) : null);

/** "4.3" in the reader's number format. */
export const starText = (avg: number, locale = "en") => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(avg);

// ── insights for suppliers ───────────────────────────────────────────────────

const THEME_WORDS: Record<Theme, string[]> = {
  DAMAGED: ["damaged", "broken", "crushed", "dented", "leak", "leaking", "danificado", "danificada", "partido", "partida", "amassado", "roto", "rota", "dañado", "abollado", "casse", "endommage", "beschadigt", "beschädigt", "kaputt", "rotto", "danneggiato", "kapot"],
  EXPIRY: ["expired", "expiry", "short date", "best before", "out of date", "validade", "caducado", "caducada", "fora de prazo", "vencido", "caducidad", "perime", "date courte", "abgelaufen", "mhd", "scaduto", "scadenza", "houdbaarheid", "verlopen"],
  TASTE: ["taste", "tasteless", "bland", "sour", "rancid", "sabor", "insipido", "rançoso", "rancio", "gout", "fade", "geschmack", "sapore", "smaak"],
  SIZE: ["small", "smaller", "weight", "underweight", "light", "pequeno", "pequena", "peso", "pequeño", "petit", "poids", "klein", "gewicht", "piccolo", "peso", "kleiner"],
  PACKAGING: ["packaging", "box", "bag", "seal", "label", "embalagem", "caixa", "saco", "rotulo", "embalaje", "caja", "emballage", "etiquette", "verpackung", "karton", "imballaggio", "verpakking"],
  PRICE: ["expensive", "overpriced", "price", "caro", "cara", "preco", "precio", "cher", "chere", "prix", "teuer", "preis", "costoso", "prezzo", "duur", "prijs"],
  TEMPERATURE: ["warm", "thawed", "defrosted", "melted", "cold chain", "quente", "descongelado", "descongelada", "derretido", "caliente", "decongele", "chaud", "aufgetaut", "warm", "scongelato", "caldo", "ontdooid"],
  MISSING: ["missing", "incomplete", "short", "falta", "faltava", "faltavam", "incompleto", "manque", "manquant", "fehlt", "fehlend", "mancante", "ontbreekt"],
};

/** The most common complaints in reviews of 3★ and below (topic and how many reviews mention it). */
export function complaints(reviews: ReviewLite[], top = 5): { theme: Theme; count: number }[] {
  const n = new Map<Theme, number>();
  for (const r of reviews) {
    if (r.stars > 3) continue;
    const t = fold(r.body ?? "");
    const hit = new Set<Theme>();
    for (const th of THEMES) if (THEME_WORDS[th].some((w) => hasWord(t, w))) hit.add(th);
    if (typeof r.packaging === "number" && r.packaging <= 2) hit.add("PACKAGING");
    if (typeof r.freshness === "number" && r.freshness <= 2) hit.add("EXPIRY");
    if (typeof r.value === "number" && r.value <= 2) hit.add("PRICE");
    for (const h of hit) n.set(h, (n.get(h) ?? 0) + 1);
  }
  return [...n.entries()].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count || THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme)).slice(0, top);
}

/** Average stars per month for the last `months` months (oldest first; null when no review that month). */
export function monthlyTrend(reviews: ReviewLite[], now: Date, months = 12): { month: string; avg: number | null; count: number }[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const acc = new Map(keys.map((k) => [k, { sum: 0, count: 0 }]));
  for (const r of reviews) {
    if (!r.createdAt) continue;
    const k = r.createdAt.toISOString().slice(0, 7);
    const a = acc.get(k);
    if (a) { a.sum += r.stars; a.count++; }
  }
  return keys.map((k) => { const a = acc.get(k)!; return { month: k, avg: a.count ? r2(a.sum / a.count) : null, count: a.count }; });
}

/** Clean a buyer's or supplier's text: trim, collapse runs of blank lines, cap the length. */
export function cleanText(t: string | null | undefined, max: number) {
  const s = (t ?? "").replace(/\r\n?/g, "\n").replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.slice(0, max);
}

export const validScore = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
