/** Texts for the staff & time pages (Phase 52): the "staff" messages in the viewer's language (English for FIRINGI's back office). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function staffLabels(english = false) {
  if (english) return { l: flat(en.staff), locale: "en" };
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.staff), ...flat(((m as { staff?: object }).staff ?? {}) as Record<string, unknown>) }, locale };
}

export const timeOf = (d: Date | string, locale: string, tz: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
export const dayOf = (d: Date | string, locale: string, tz: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(d));
export const dayLabel = (day: string, locale: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`));
export const hoursText = (min: number) => `${Math.floor(Math.max(0, min) / 60)}:${String(Math.round(Math.max(0, min) % 60)).padStart(2, "0")}`;
export const money = (n: number, locale: string, currency = "EUR") => new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
