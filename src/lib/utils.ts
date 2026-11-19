import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { decimalsOf, fxAmount, type Fx } from "./currency";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | string | null | undefined, locale = "en", withTime = false) {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Europe/Lisbon",
  }).format(new Date(d));
}

/**
 * Money. `currency` is a currency code (the value is already in it) or a viewer's Fx (Phase 45: the value is in
 * EUR and is shown converted at the viewer's rate).
 */
export function formatMoney(value: string | number | { toString(): string }, locale = "pt-PT", currency: string | Fx = "EUR") {
  const code = typeof currency === "string" ? currency : currency.code;
  const n = typeof currency === "string" ? Number(value.toString()) : fxAmount(currency, value);
  const dp = decimalsOf(code);
  return new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
}

/** An EUR amount in the viewer's currency, with "≈ €…" after it when the viewer wants EUR shown alongside. */
export function formatMoneyEur(value: string | number | { toString(): string }, locale: string, fx: Fx | null | undefined) {
  if (!fx || fx.code === "EUR") return formatMoney(value, locale);
  const main = formatMoney(value, locale, fx);
  return fx.showEur ? `${main} (≈ ${formatMoney(value, locale)})` : main;
}
