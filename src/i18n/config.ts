/**
 * Locales that ship a UI translation file (src/messages/<code>.json). Every company works in its
 * country's language by default and can always switch to English. A language without a file
 * falls back to English.
 */
export const UI_LOCALES = ["en", "pt-PT", "es", "fr", "de", "it", "nl", "pl", "ro", "cs", "sk", "hu", "hr", "sl", "bg", "el", "da"] as const;

/** Map a browser/base language tag to a UI locale, or null. */
export function toUiLocale(tag: string): string | null {
  const t = tag.toLowerCase();
  const list = UI_LOCALES as readonly string[];
  const exact = list.find((l) => l.toLowerCase() === t);
  if (exact) return exact;
  const base = t.split("-")[0];
  return list.find((l) => l.split("-")[0] === base) ?? null;
}
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Resolve a localized JSON value `{ en, pt, es, … }` with English fallback. */
export function pickLocalized(value: unknown, locale: string): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  const v = value as Record<string, string>;
  const base = locale.split("-")[0];
  return v[locale] ?? v[base] ?? v.en ?? Object.values(v)[0] ?? "";
}
