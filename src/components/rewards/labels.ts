/** Texts for the rewards shop (Phase 55): the "rewardsShop" messages in the viewer's language (English for missing keys). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function rewardsLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.rewardsShop), ...flat(((m as { rewardsShop?: object }).rewardsShop ?? {}) as Record<string, unknown>) }, locale };
}

export const eur = (n: number | string | null | undefined, locale: string) => (n == null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(n)));
export const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
export const day = (d: Date | string, locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
