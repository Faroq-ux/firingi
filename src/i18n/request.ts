import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, UI_LOCALES } from "./config";
import en from "@/messages/en.json";

type Messages = Record<string, unknown>;

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge((base[k] as Messages) ?? {}, v as Messages) : v;
  }
  return out;
}

/**
 * Locale comes from the cookie (set at login from the user's preference / company
 * country). Missing translations fall back to English key-by-key.
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE;
  const locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  let messages: Messages = en;
  if ((UI_LOCALES as readonly string[]).includes(locale) && locale !== "en") {
    const local = (await import(`@/messages/${locale}.json`)).default as Messages;
    messages = deepMerge(en, local);
  }
  return { locale, messages, timeZone: "Europe/Lisbon" };
});
