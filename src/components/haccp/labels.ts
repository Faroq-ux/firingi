/** Texts for the food safety logbook (Phase 69): the "haccp" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
const base = () => ((en as unknown as { haccp?: Record<string, unknown> }).haccp ?? {});

export async function haccpLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(base()), ...flat(((m as { haccp?: object }).haccp ?? {}) as Record<string, unknown>) }, locale };
}
