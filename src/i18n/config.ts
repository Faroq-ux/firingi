/** Locales that ship a UI translation file. Any other country language falls back to English. */
export const UI_LOCALES = ["en", "pt-PT", "es"] as const;
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
