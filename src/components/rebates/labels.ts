/** Texts for the rebate pages (Phase 48): the "rebates" messages in the viewer's language (English as fallback; FIRINGI pages English only). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";
import type { RebateRules } from "@/lib/rebates";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function rebateLabels(english = false) {
  const [m, locale] = english ? [{}, "en"] : await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.rebates), ...flat(((m as { rebates?: object }).rebates ?? {}) as Record<string, unknown>) }, locale };
}

/** "2 % from 5 000,00 € · 3 % from 10 000,00 € (on the whole period)" … */
export function rulesText(l: Record<string, string>, rules: RebateRules, locale: string) {
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  switch (rules.kind) {
    case "VOLUME":
      return `${rules.tiers.map((t) => fill(l["rules.VOLUME"], { pct: t.pct, from: rules.basis === "AMOUNT" ? money(t.from) : fill(l["rules.units"], { n: num(t.from) }) })).join(" · ")} (${rules.retro ? l["rules.retro"] : l["rules.stepped"]})`;
    case "FREE_GOODS":
      return `${fill(l["rules.FREE_GOODS"], { buy: num(rules.buyUnits), free: num(rules.freeUnits) })}${rules.maxFreePerPeriod ? ` (${fill(l["rules.FREE_GOODS_MAX"], { max: num(rules.maxFreePerPeriod) })})` : ""}`;
    case "GROWTH":
      return `${rules.tiers.map((t) => fill(l["rules.GROWTH"], { growth: t.growthPct, pct: t.pct })).join(" · ")} (${rules.base === "TOTAL" ? l["rules.TOTAL"] : l["rules.INCREASE"]})`;
    case "MIX":
      return `${fill(l["rules.MIX"], { n: rules.minDistinct, each: rules.minUnitsEach })} → ${[rules.rewardFixed ? money(rules.rewardFixed) : null, rules.rewardPct ? `${rules.rewardPct} %` : null].filter(Boolean).join(" + ")}`;
  }
}
