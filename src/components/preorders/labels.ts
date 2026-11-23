/** Texts for the pre-orders & price locks (Phase 71): the "preorders" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
const base = () => ((en as unknown as { preorders?: Record<string, unknown> }).preorders ?? {});

export async function preLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(base()), ...flat(((m as { preorders?: object }).preorders ?? {}) as Record<string, unknown>) }, locale };
}
