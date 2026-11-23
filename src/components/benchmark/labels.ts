/** Texts for the price benchmark (Phase 70): the "benchmark" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
const base = () => ((en as unknown as { benchmark?: Record<string, unknown> }).benchmark ?? {});

export async function benchLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(base()), ...flat(((m as { benchmark?: object }).benchmark ?? {}) as Record<string, unknown>) }, locale };
}
