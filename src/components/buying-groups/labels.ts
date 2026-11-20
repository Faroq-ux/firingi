/** Texts for the buying group pages (Phase 49): the "groups" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function groupLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.groups), ...flat(((m as { groups?: object }).groups ?? {}) as Record<string, unknown>) }, locale };
}
