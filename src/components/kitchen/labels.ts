/** Texts for menu costing & waste (Phase 54): the "kitchen" messages in the viewer's language. */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function kitchenLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  // allergen names come from the food-information texts (Phase 44)
  const food = { ...flat(en.food.a, "allergen."), ...flat(((m as { food?: { a?: object } }).food?.a ?? {}) as Record<string, unknown>, "allergen.") };
  return { l: { ...flat(en.kitchen), ...flat(((m as { kitchen?: object }).kitchen ?? {}) as Record<string, unknown>), ...food }, locale };
}

export const eur = (n: number | null | undefined, locale: string, digits = 2) => (n == null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n));
export const pct = (n: number | null | undefined, locale: string) => (n == null ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)} %`);
export const qtyText = (n: number | null | undefined, locale: string, digits = 2) => (n == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n));
export const dateText = (d: Date | string, locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(d));
