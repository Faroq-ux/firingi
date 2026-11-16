/** Texts for the deal pages (Phase 38): the "deals" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";
import type { Tier } from "@/lib/deals";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function dealLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.deals), ...flat(((m as { deals?: object }).deals ?? {}) as Record<string, unknown>) }, locale };
}

/** "3 for 20,00 €" · "from 10: 9,00 € · from 50: 8,00 €" · "40 units for 300,00 €" … */
export function termsText(l: Record<string, string>, d: { kind: string; dealPrice?: unknown; bundleQty?: number | null; bundlePrice?: unknown; tiers?: unknown; maxQty?: number | null; lotPrice?: unknown; floorPrice?: unknown }, locale: string, opts: { supplier?: boolean } = {}) {
  const money = (n: unknown) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(n));
  switch (d.kind) {
    case "FLASH": return fill(l["terms.FLASH"], { price: money(d.dealPrice) });
    case "BUNDLE": return fill(l["terms.BUNDLE"], { n: d.bundleQty ?? 0, price: money(d.bundlePrice) });
    case "VOLUME": return ((d.tiers as Tier[] | null) ?? []).map((t) => fill(l["terms.VOLUME"], { n: t.minQty, price: money(t.unitPrice) })).join(" · ");
    case "LOT": return fill(l["terms.LOT"], { n: d.maxQty ?? 0, price: money(d.lotPrice) });
    case "BEST_OFFER": return opts.supplier && d.floorPrice != null ? fill(l["terms.BEST_OFFER_FLOOR"], { price: money(d.floorPrice) }) : l["terms.BEST_OFFER"];
    default: return "";
  }
}
