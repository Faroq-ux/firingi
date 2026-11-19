/** Texts for the licensed-goods pages (Phase 43): the "excise" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function exLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  const base = (en as unknown as { excise: Record<string, unknown> }).excise;
  return { l: { ...flat(base), ...flat(((m as { excise?: object }).excise ?? {}) as Record<string, unknown>) }, locale };
}

/** English texts (FIRINGI admin pages). */
export const enLabels = () => flat((en as unknown as { excise: Record<string, unknown> }).excise);
