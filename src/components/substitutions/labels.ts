/** Texts for replacements (Phase 60): the "substitutions" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const base = () => (en as unknown as { substitutions: Record<string, unknown> }).substitutions;

export async function subLabels(english = false) {
  if (english) return { l: flat(base()), locale: "en" };
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(base()), ...flat(((m as { substitutions?: object }).substitutions ?? {}) as Record<string, unknown>) }, locale };
}
