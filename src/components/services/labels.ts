/** Texts for Services (Phase 68): the "services" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
const base = () => (en as unknown as { services: Record<string, unknown> }).services;

export async function svLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(base()), ...flat(((m as { services?: object }).services ?? {}) as Record<string, unknown>) }, locale };
}

/** English texts (FIRINGI's admin pages are in English). */
export function svLabelsEn() {
  return { l: flat(base()), locale: "en" };
}
