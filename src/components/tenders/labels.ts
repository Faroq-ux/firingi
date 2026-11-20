/** Texts for the tender pages (Phase 50): the "tenders" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function tenderLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.tenders), ...flat(((m as { tenders?: object }).tenders ?? {}) as Record<string, unknown>) }, locale };
}

export const statusTone = (s: string) => (s === "OPEN" ? "success" : s === "AWARDED" || s === "WON" ? "default" : s === "PENDING" || s === "CLOSED" || s === "SUBMITTED" ? "warning" : "secondary") as "success" | "default" | "warning" | "secondary";
