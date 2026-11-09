import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, UI_LOCALES, toUiLocale } from "./config";
import en from "@/messages/en.json";

type Messages = Record<string, unknown>;

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge((base[k] as Messages) ?? {}, v as Messages) : v;
  }
  return out;
}

/** Best UI locale from the browser's Accept-Language (used before anyone signs in). */
export function localeFromAcceptLanguage(header: string | null): string {
  if (!header) return DEFAULT_LOCALE;
  const langs = header.split(",").map((part) => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.find((x) => x.trim().startsWith("q="));
    return { tag: tag.toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
  }).sort((a, b) => b.q - a.q);
  for (const { tag } of langs) {
    const ui = toUiLocale(tag);
    if (ui) return ui;
  }
  return DEFAULT_LOCALE;
}

/**
 * Locale comes from the cookie (set at login from the user's preference / company
 * country). Without a cookie (first visit, login page) the browser language decides, if we
 * have that language; otherwise English. Missing translations fall back to English key-by-key.
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value ?? localeFromAcceptLanguage((await headers()).get("accept-language"));
  const locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  let messages: Messages = en;
  if ((UI_LOCALES as readonly string[]).includes(locale) && locale !== "en") {
    const local = (await import(`@/messages/${locale}.json`)).default as Messages;
    messages = deepMerge(en, local);
  }
  return { locale, messages, timeZone: "Europe/Lisbon" };
});
