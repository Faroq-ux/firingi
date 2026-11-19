/** Texts for the food-information pages and PDFs (Phase 44): the "food" messages, English as fallback. */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";
import { UI_LOCALES, toUiLocale } from "@/i18n/config";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const base = () => flat((en as unknown as { food: Record<string, unknown> }).food);

/** The viewer's language (request locale). */
export async function foodLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...base(), ...flat(((m as { food?: object }).food ?? {}) as Record<string, unknown>) }, locale };
}

/** Any of our languages (the public page's ?lang=, the reseller's PDFs) — unknown ones fall back to English. */
export async function foodLabelsFor(raw: string | null | undefined) {
  const locale = (raw && toUiLocale(raw)) || "en";
  if (locale === "en" || !(UI_LOCALES as readonly string[]).includes(locale)) return { l: base(), locale: "en" };
  const local = (await import(`@/messages/${locale}.json`)).default as { food?: Record<string, unknown> };
  return { l: { ...base(), ...flat(local.food ?? {}) }, locale };
}

/** English texts (FIRINGI admin pages). */
export const enFoodLabels = () => base();
