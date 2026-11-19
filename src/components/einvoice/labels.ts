/** Texts for the e-invoicing pages (Phase 46): the "einvoice" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function einLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  const base = (en as unknown as { einvoice: Record<string, unknown> }).einvoice;
  return { l: { ...flat(base), ...flat(((m as { einvoice?: object }).einvoice ?? {}) as Record<string, unknown>) }, locale };
}
