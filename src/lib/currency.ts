/**
 * Phase 45 — multi-currency rules (pure, shared by server and pages).
 *
 * FIRINGI keeps its books in EUR: every order, invoice and payment amount stays in EUR, and a document in
 * another currency also carries its amounts in that currency with the rate locked when it was made.
 *
 *   • reference rate ("mid") — units of the currency per €1 (ECB daily reference, or set by FIRINGI)
 *   • customer rate — mid × (1 + FX margin %) for amounts FIRINGI converts from EUR for a customer
 *   • a price list already in the customer's own currency (fixed local price) is used exactly, with no margin
 *   • supplier prices in the supplier's own currency are turned into EUR at the mid rate
 */
import Decimal from "decimal.js";

/** The non-euro Schengen countries and their currency. */
export const NON_EURO_COUNTRIES = { CH: "CHF", LI: "CHF", NO: "NOK", IS: "ISK", DK: "DKK", SE: "SEK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON" } as const;
export type LocalCountry = keyof typeof NON_EURO_COUNTRIES;
export const LOCAL_COUNTRIES = Object.keys(NON_EURO_COUNTRIES) as LocalCountry[];
export const LOCAL_CURRENCIES = [...new Set(Object.values(NON_EURO_COUNTRIES))] as string[];

/** Minor units (ISO 4217): the króna has none. */
export const decimalsOf = (code: string) => (code === "ISK" ? 0 : 2);

export type CurrencySettings = {
  /** master switch: off = everything in EUR, as before */
  enabled: boolean;
  /** country code → customers there see, order and pay in their own currency */
  countries: Record<string, boolean>;
  /** show the EUR amount alongside the local one */
  showEur: boolean;
  /** suppliers in an enabled country price in their own currency */
  supplierCurrency: boolean;
  /** suppliers' statements and payouts in their own currency */
  payoutsLocal: boolean;
  /** fixed price lists in a customer currency are used exactly */
  localPriceLists: boolean;
  /** FX margin % added on conversions from EUR for customers, per currency */
  margins: Record<string, number>;
  /** where rates come from: the ECB daily reference rates, or FIRINGI types them in */
  feed: "ECB" | "MANUAL";
  /** fetch the ECB rates every working day */
  autoFetch: boolean;
  /** alert when a rate moved more than this % since the last one */
  alertMovePct: number;
  alertFeedFailure: boolean;
  /** alert when the newest rate is older than this many days */
  staleDays: number;
  /** invoices in another currency show the EUR equivalent of the VAT and totals */
  invoiceEurEquivalent: boolean;
  /** book realised exchange gains/losses when payments settle */
  fxAccounting: boolean;
  /** currency switch on FIRINGI reports */
  reportSwitch: boolean;
};

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = {
  enabled: true,
  countries: Object.fromEntries(LOCAL_COUNTRIES.map((c) => [c, false])),
  showEur: true,
  supplierCurrency: true,
  payoutsLocal: true,
  localPriceLists: true,
  margins: Object.fromEntries(LOCAL_CURRENCIES.map((c) => [c, 0])),
  feed: "ECB",
  autoFetch: true,
  alertMovePct: 2,
  alertFeedFailure: true,
  staleDays: 4,
  invoiceEurEquivalent: true,
  fxAccounting: true,
  reportSwitch: true,
};

export function mergeCurrencySettings(raw: unknown): CurrencySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CurrencySettings>;
  const d = DEFAULT_CURRENCY_SETTINGS;
  const b = (v: unknown, x: boolean) => (typeof v === "boolean" ? v : x);
  const num = (v: unknown, x: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : x);
  const c = (r.countries ?? {}) as Record<string, unknown>;
  const m = (r.margins ?? {}) as Record<string, unknown>;
  return {
    enabled: b(r.enabled, d.enabled),
    countries: Object.fromEntries(LOCAL_COUNTRIES.map((k) => [k, b(c[k], false)])),
    showEur: b(r.showEur, d.showEur),
    supplierCurrency: b(r.supplierCurrency, d.supplierCurrency),
    payoutsLocal: b(r.payoutsLocal, d.payoutsLocal),
    localPriceLists: b(r.localPriceLists, d.localPriceLists),
    margins: Object.fromEntries(LOCAL_CURRENCIES.map((k) => [k, Math.round(num(m[k], 0, 0, 10) * 100) / 100])),
    feed: r.feed === "MANUAL" ? "MANUAL" : "ECB",
    autoFetch: b(r.autoFetch, d.autoFetch),
    alertMovePct: Math.round(num(r.alertMovePct, d.alertMovePct, 0.1, 25) * 10) / 10,
    alertFeedFailure: b(r.alertFeedFailure, d.alertFeedFailure),
    staleDays: Math.round(num(r.staleDays, d.staleDays, 1, 30)),
    invoiceEurEquivalent: b(r.invoiceEurEquivalent, d.invoiceEurEquivalent),
    fxAccounting: b(r.fxAccounting, d.fxAccounting),
    reportSwitch: b(r.reportSwitch, d.reportSwitch),
  };
}

/** The currency a company in this country is billed in (customers) / paid in (suppliers). */
export function currencyForCountry(s: CurrencySettings, countryCode: string, role: "BUYER" | "SUPPLIER"): string {
  if (!s.enabled || !s.countries[countryCode]) return "EUR";
  if (role === "SUPPLIER" && !s.supplierCurrency) return "EUR";
  return NON_EURO_COUNTRIES[countryCode as LocalCountry] ?? "EUR";
}

// ── conversion ──────────────────────────────────────────────────────────────

type Num = Decimal.Value | { toString(): string };
const D = (v: Num) => new Decimal(typeof v === "object" && !(v instanceof Decimal) ? v.toString() : (v as Decimal.Value));

export const customerRate = (mid: Num, marginPct: Num) => D(mid).mul(D(marginPct).div(100).plus(1)).toDecimalPlaces(8);
export const roundMoney = (v: Num, code: string) => D(v).toDecimalPlaces(decimalsOf(code), Decimal.ROUND_HALF_UP);
/** EUR → the currency at `rate` units per €, rounded to the currency's minor unit. */
export const toLocal = (eur: Num, rate: Num, code: string) => roundMoney(D(eur).mul(D(rate)), code);
/** An amount in a currency → EUR (4 decimals: unit prices; round to 2 for amounts). */
export const toEur = (local: Num, rate: Num, dp = 4) => D(local).div(D(rate)).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);

/**
 * How the viewer sees money: currency, the rate from EUR (customer rate for customers, mid for suppliers),
 * and whether EUR is shown alongside. Serializable (pages pass it to client components).
 */
export type Fx = { code: string; rate: string; mid: string; marginPct: number; decimals: number; showEur: boolean; date: string | null };
export const EUR_FX: Fx = { code: "EUR", rate: "1", mid: "1", marginPct: 0, decimals: 2, showEur: false, date: null };
export const isLocal = (fx: Fx | null | undefined): fx is Fx => !!fx && fx.code !== "EUR";
/** An EUR amount in the viewer's currency (a number, for formatting). */
export const fxAmount = (fx: Fx | null | undefined, eur: Num) => (isLocal(fx) ? toLocal(eur, fx.rate, fx.code).toNumber() : Number(D(eur).toFixed(2)));

/** A document's own rate, as an Fx (orders, invoices: the locked rate). */
export function docFx(doc: { currencyCode: string; eurRate?: Num | null; midRate?: Num | null }, showEur = false): Fx {
  if (doc.currencyCode === "EUR") return EUR_FX;
  return { code: doc.currencyCode, rate: D(doc.eurRate ?? 1).toString(), mid: D(doc.midRate ?? doc.eurRate ?? 1).toString(), marginPct: 0, decimals: decimalsOf(doc.currencyCode), showEur, date: null };
}

// ── document amounts in the document's currency ─────────────────────────────

/** `vatFromEur`: a document line that is not a goods line (fee, deposit, excise): its VAT converted like the order's (not re-worked out). */
export type LocalLineIn = { lineNet: Num; lineVat: Num; taxRate: Num; unitSaleEur: Num; unitLocal?: Num | null; vatFromEur?: boolean };
export type LocalLineOut = { unitLocal: Decimal; netLocal: Decimal; vatLocal: Decimal };

/**
 * A document's lines and totals in its currency. Each line keeps its local unit price (exact for a fixed
 * local price; else EUR × rate) and its local net follows the EUR line (same quantity / weight); VAT is
 * worked out on the local net. What is on the document but not on a line (delivery, excise added, deposits …)
 * is converted at the document rate.
 */
export function localAmounts(lines: LocalLineIn[], totals: { net: Num; vat: Num; grand: Num }, rate: Num, code: string) {
  const out: LocalLineOut[] = lines.map((l) => {
    const unitEur = D(l.unitSaleEur);
    const unitLocal = l.unitLocal != null ? D(l.unitLocal) : unitEur.mul(D(rate)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const ratio = unitEur.isZero() ? D(rate) : unitLocal.div(unitEur);
    const netLocal = roundMoney(D(l.lineNet).mul(ratio), code);
    const vatLocal = l.vatFromEur ? roundMoney(D(l.lineVat).mul(ratio), code) : roundMoney(netLocal.mul(D(l.taxRate)).div(100), code);
    return { unitLocal, netLocal, vatLocal };
  });
  const sumEur = (k: "lineNet" | "lineVat") => lines.reduce((a, l) => a.plus(D(l[k])), new Decimal(0));
  const sumLoc = (k: "netLocal" | "vatLocal") => out.reduce((a, l) => a.plus(l[k]), new Decimal(0));
  const net = sumLoc("netLocal").plus(toLocal(D(totals.net).minus(sumEur("lineNet")), rate, code));
  const vat = sumLoc("vatLocal").plus(toLocal(D(totals.vat).minus(sumEur("lineVat")), rate, code));
  const other = D(totals.grand).minus(D(totals.net)).minus(D(totals.vat));
  const grand = net.plus(vat).plus(toLocal(other, rate, code));
  return { lines: out, net, vat, grand };
}

/**
 * Realised exchange difference in EUR when `amountLocal` settles a document booked at `docRate` and the money
 * is worth `settleRate` on the day: + gain / − loss. For a payable (FIRINGI pays) the sign is reversed.
 */
export function fxGainLoss(amountLocal: Num, docRate: Num, settleRate: Num, kind: "RECEIVABLE" | "PAYABLE" = "RECEIVABLE") {
  const atSettle = D(amountLocal).div(D(settleRate));
  const atDoc = D(amountLocal).div(D(docRate));
  const diff = atSettle.minus(atDoc).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return kind === "RECEIVABLE" ? diff : diff.neg();
}

/** % move between two rates (signed). */
export const movePct = (prev: Num, next: Num) => D(next).div(D(prev)).minus(1).mul(100).toDecimalPlaces(3).toNumber();

// ── ECB daily reference rates ───────────────────────────────────────────────

/** The ECB eurofxref-daily XML → its date and the rates (units per €). */
export function parseEcb(xml: string): { date: string; rates: Record<string, string> } | null {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Record<string, string> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) rates[m[1]] = m[2];
  return Object.keys(rates).length ? { date, rates } : null;
}
