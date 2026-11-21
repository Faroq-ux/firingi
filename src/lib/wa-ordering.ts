/**
 * WhatsApp ordering with AI (Phase 58) — settings and the pure rules: recognising a confirmation / cancel /
 * repeat reply in any of FIRINGI's languages, the customer's language from the phone number, and turning the
 * agent's Markdown into WhatsApp text.
 */

export type WaAudiences = {
  /** wholesale customers (shops, cafés, restaurants) order by WhatsApp */
  customers: boolean;
  /** wholesalers restock from distributors by WhatsApp */
  wholesalers: boolean;
  /** numbers FIRINGI doesn't know get the registration link (and become a CRM lead) */
  unknownNumbers: boolean;
};

export type WaSettings = {
  enabled: boolean;
  audiences: WaAudiences;
  inputs: { photos: boolean; voice: boolean; buttons: boolean };
  /** a proposal waits this long for the YES */
  draftMinutes: number;
  /** after a hand-over the AI stays quiet this long (a person answers in the inbox) */
  pauseHours: number;
  /** messages per business per hour the AI answers */
  hourlyLimit: number;
  orderUpdates: boolean;
  payLinks: boolean;
  reminders: { enabled: boolean; daysBefore: number };
  /** approved WhatsApp templates for messages outside the customer's 24-hour window (Meta needs them) */
  templates: { orderUpdate: string; reminder: string; language: string };
};

export const DEFAULT_WA: WaSettings = {
  enabled: true,
  audiences: { customers: true, wholesalers: false, unknownNumbers: false },
  inputs: { photos: true, voice: true, buttons: true },
  draftMinutes: 120,
  pauseHours: 24,
  hourlyLimit: 40,
  orderUpdates: true,
  payLinks: true,
  reminders: { enabled: true, daysBefore: 0 },
  templates: { orderUpdate: "", reminder: "", language: "pt_PT" },
};

const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const n = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : d);

export function mergeWaSettings(raw: unknown): WaSettings {
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const d = DEFAULT_WA;
  const g = (k: string) => ((r[k] && typeof r[k] === "object" ? r[k] : {}) as Record<string, unknown>);
  const a = g("audiences"), i = g("inputs"), rm = g("reminders"), tp = g("templates");
  const tn = (v: unknown) => (typeof v === "string" && /^[a-z0-9_]{0,512}$/.test(v) ? v : "");
  return {
    enabled: b(r.enabled, d.enabled),
    audiences: { customers: b(a.customers, d.audiences.customers), wholesalers: b(a.wholesalers, d.audiences.wholesalers), unknownNumbers: b(a.unknownNumbers, d.audiences.unknownNumbers) },
    inputs: { photos: b(i.photos, d.inputs.photos), voice: b(i.voice, d.inputs.voice), buttons: b(i.buttons, d.inputs.buttons) },
    draftMinutes: n(r.draftMinutes, d.draftMinutes, 10, 1440),
    pauseHours: n(r.pauseHours, d.pauseHours, 1, 168),
    hourlyLimit: n(r.hourlyLimit, d.hourlyLimit, 1, 500),
    orderUpdates: b(r.orderUpdates, d.orderUpdates),
    payLinks: b(r.payLinks, d.payLinks),
    reminders: { enabled: b(rm.enabled, d.reminders.enabled), daysBefore: n(rm.daysBefore, d.reminders.daysBefore, 0, 7) },
    templates: { orderUpdate: tn(tp.orderUpdate), reminder: tn(tp.reminder), language: typeof tp.language === "string" && /^[a-z]{2}(_[A-Z]{2})?$/.test(tp.language) ? tp.language : d.templates.language },
  };
}

// ── replies FIRINGI understands without the AI ──

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[!.¡¿?,;:"'“”«»👍✅❌]/g, " ").replace(/\s+/g, " ").trim();
/** "yes" in FIRINGI's languages (and the button ids). */
const YES = new Set([
  "yes", "y", "ok", "okay", "confirm", "confirmed", "go", "place", "place order", "place it", "order it",
  "sim", "s", "confirmo", "confirmar", "pode", "pode ser", "encomendar", "esta bem", "ta bem", "si", "vale", "de acuerdo", "pedir",
  "oui", "d accord", "valider", "commander", "ja", "jawohl", "bestatigen", "bestellen", "si confermo", "conferma", "va bene",
  "tak", "potwierdzam", "zamawiam", "ano", "potvrdit", "potvrdzujem", "igen", "rendben", "da", "potvrdi", "potrjujem", "jah", "kinnitan",
  "taip", "patvirtinu",  "ja bekraft", "bekrafta", "bekraeft", "ja tak", "kylla", "vahvistan", "nai", "επιβεβαιωνω", "ναι", "да", "потвърждавам",
  "iva", "konfermat", "haa", "ha", "হ্যাঁ", "हाँ", "हां", "ji", "wa confirm", "wa_confirm",
]);
const NO = new Set([
  "nee", "nei", "no", "n", "cancel", "stop", "dont", "don t", "nao", "não", "cancelar", "cancela", "annuler", "non", "nein", "abbrechen", "annulla",
  "nie", "anuluj", "ne", "zrusit", "nem", "anulare", "nu", "otkazi", "preklici", "ei", "loobu", "atsaukti", "atcelt", "nej", "avbryt", "afbryd", "peruuta",
  "οχι", "ακυρωση", "не", "отказ", "le", "ikkanċella", "na", "নাহ", "না", "नहीं", "wa cancel", "wa_cancel",
]);
const REPEAT = new Set([
  "repeat", "repeat last", "same again", "same as last", "repetir", "o mesmo", "igual", "mesma encomenda", "lo mismo", "meme chose", "pareil", "repeter", "nochmal", "wiederholen",
  "ripeti", "powtorz", "znovu", "zopakovat", "gentag", "gjenta", "upprepa", "herhaal", "toista", "uuesti", "kartoti", "atkartot", "ujra", "aftur", "repeta", "ponovi", "irrepeti",
  "ξανα", "отново", "wa repeat", "wa_repeat",
]);
/** The words the translated messages ask for (src/messages › waOrder) — each must mean one thing only. */
export const KEYWORDS = { YES, NO, REPEAT };

export type Intent = "YES" | "NO" | "REPEAT" | null;
/** A short reply that is just yes / no / repeat (anything longer goes to the AI). */
export function intentOf(text: string): Intent {
  const t = norm(text);
  if (!t || t.length > 30) return null;
  if (YES.has(t)) return "YES";
  if (NO.has(t)) return "NO";
  if (REPEAT.has(t)) return "REPEAT";
  return null;
}

// ── language ──

/** The customer's language from the number's country code (until FIRINGI knows the user). */
const PREFIX: [string, string][] = [
  ["351", "pt-PT"], ["34", "es"], ["33", "fr"], ["49", "de"], ["39", "it"], ["31", "nl"], ["32", "nl"], ["48", "pl"], ["420", "cs"], ["421", "sk"],
  ["36", "hu"], ["40", "ro"], ["359", "bg"], ["30", "el"], ["385", "hr"], ["386", "sl"], ["372", "et"], ["371", "lv"], ["370", "lt"], ["46", "sv"],
  ["45", "da"], ["47", "nb"], ["358", "fi"], ["354", "is"], ["356", "mt"], ["43", "de"], ["41", "de"], ["352", "fr"], ["423", "de"],
];
export function localeFromPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  for (const [p, l] of [...PREFIX].sort((a, z) => z[0].length - a[0].length)) if (d.startsWith(p)) return l;
  return "en";
}

// ── WhatsApp text ──

/** Markdown from the agent → WhatsApp formatting: *bold*, plain lists, tables as lines, no links markup. */
export function toWhatsApp(md: string): string {
  let t = md.replace(/\r/g, "");
  t = t.replace(/^\s*\|?\s*:?-{2,}.*$/gm, ""); // table separator rows
  t = t.replace(/^\s*\|(.+)\|\s*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(" · "));
  t = t.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/__(.+?)__/g, "*$1*");
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1: $2");
  t = t.replace(/\*\(simulated assistant — no AI connected\)\*/g, "(simulated assistant)");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t.length > 3900 ? `${t.slice(0, 3890)}…` : t;
}

/** Stable fingerprint of a cart: offer and quantity per line, sorted. */
export function cartHash(lines: { offerId: string; qty: number }[]): string {
  const s = [...lines].sort((a, z) => a.offerId.localeCompare(z.offerId)).map((l) => `${l.offerId}:${l.qty}`).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${lines.length}-${h.toString(16)}`;
}
