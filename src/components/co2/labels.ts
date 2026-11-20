/** Texts for the sustainability & CO₂ pages (Phase 51): the "co2" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function co2Labels(english = false) {
  if (english) return { l: flat(en.co2), locale: "en" };
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.co2), ...flat(((m as { co2?: object }).co2 ?? {}) as Record<string, unknown>) }, locale };
}

/** "1 234,5 kg CO₂e" / "980 g CO₂e" in the viewer's locale. */
export function kgText(kg: number, locale: string) {
  if (Math.abs(kg) < 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kg * 1000)} g CO₂e`;
  if (Math.abs(kg) >= 10000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kg / 1000)} t CO₂e`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: kg < 100 ? 1 : 0 }).format(kg)} kg CO₂e`;
}
