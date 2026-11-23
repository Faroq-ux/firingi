/** Texts for consignment stock (Phase 65): the "consignment" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const base = () => (en as unknown as { consignment: Record<string, unknown> }).consignment;

export async function csLabels(english = false) {
  if (english) return { l: flat(base()), locale: "en" };
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(base()), ...flat(((m as { consignment?: object }).consignment ?? {}) as Record<string, unknown>) }, locale };
}
