/**
 * Phase 47 — POS (shop till) shared logic: FIRINGI's settings, the money maths the till and the server both use
 * (so an offline sale adds up to the same cents on the server), receipt numbers, loyalty points and recipe units.
 */
import Decimal from "decimal.js";
import { SCHENGEN } from "@/lib/einvoice";
import { NON_EURO_COUNTRIES } from "@/lib/currency";

export const POS_TYPES = ["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"] as const;
export type PosCompanyType = (typeof POS_TYPES)[number];

export const POS_PROVIDERS = ["moloni", "fiscal-cloud", "fiscal-device"] as const;
export type PosProvider = (typeof POS_PROVIDERS)[number];
export const POS_PROVIDER_INFO: Record<PosProvider, { name: string; about: string; countries: readonly string[] }> = {
  moloni: { name: "Moloni (AT-certified invoicing)", about: "Simplified invoices / invoice-receipts in the business's own Moloni account (Portugal).", countries: ["PT"] },
  "fiscal-cloud": {
    name: "Certified cloud fiscalisation service",
    about: "Signs each receipt in the cloud for the country's rules (Germany TSE, Austria RKSV, Spain Verifactu, Italy RT, France NF525 …) under the business's own account.",
    countries: SCHENGEN,
  },
  "fiscal-device": {
    name: "Fiscal printer / online cash register",
    about: "Receipts printed and reported by the business's own certified fiscal device, connected through a local bridge (Poland, Hungary, Croatia, Greece …).",
    countries: SCHENGEN,
  },
};

export type PosStage = "NONFISCAL" | "PROVIDER";
export type PosCountry = { enabled: boolean; stage: PosStage; provider: PosProvider | null; fallbackNonFiscal: boolean };
export const POS_FEATURES = ["offline", "scale", "cash", "card", "mbway", "loyalty", "recipes", "tables", "kitchen", "emailReceipt", "accounting", "ageCheck"] as const;
export type PosFeature = (typeof POS_FEATURES)[number];
export const POS_FEATURE_LABEL: Record<PosFeature, string> = {
  offline: "Keep selling without internet (sales are sent when back online)",
  scale: "Weighed items and scale labels",
  cash: "Cash, cash drawer, shift open/close (X/Z reports)",
  card: "Card payments (terminal)",
  mbway: "MB WAY payments (Portugal)",
  loyalty: "The business's own loyalty card for its guests",
  recipes: "Recipes: dishes take ingredients bought on FIRINGI from stock",
  tables: "Open tables / tabs",
  kitchen: "Kitchen tickets",
  emailReceipt: "E-mail / QR receipts",
  accounting: "Z reports go into the company's accounting (when on)",
  ageCheck: "Age check for alcohol and tobacco",
};

export type PosSettings = {
  enabled: boolean;
  types: Record<PosCompanyType, boolean>;
  countries: Record<string, PosCountry>;
  features: Record<PosFeature, boolean>;
  /** the till stops after this many hours without reaching FIRINGI */
  offlineHours: number;
  /** … or this many sales waiting to be sent */
  offlineMaxSales: number;
  /** tills a business may have without FIRINGI's approval (each further till waits for the admin); 0 = every till */
  tillsWithoutApproval: number;
};

/** The provider FIRINGI suggests for a country (the admin decides; every country starts non-fiscal). */
export const suggestedProvider = (cc: string): PosProvider => (cc === "PT" ? "moloni" : ["PL", "HU", "HR", "GR", "BG", "RO", "SK", "CZ", "SI", "LT", "LV"].includes(cc) ? "fiscal-device" : "fiscal-cloud");

export const DEFAULT_POS_SETTINGS: PosSettings = {
  enabled: true,
  types: { DISTRIBUTOR: true, WHOLESALER: true, CUSTOMER: true },
  countries: Object.fromEntries(SCHENGEN.map((c) => [c, { enabled: true, stage: "NONFISCAL", provider: suggestedProvider(c), fallbackNonFiscal: false }])),
  features: Object.fromEntries(POS_FEATURES.map((f) => [f, true])) as Record<PosFeature, boolean>,
  offlineHours: 24,
  offlineMaxSales: 500,
  tillsWithoutApproval: 1,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const int = (v: unknown, d: number, min: number, max: number) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);

export function mergePosSettings(raw: unknown): PosSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PosSettings>;
  const d = DEFAULT_POS_SETTINGS;
  return {
    enabled: bool(r.enabled, d.enabled),
    types: Object.fromEntries(POS_TYPES.map((t) => [t, bool(r.types?.[t], d.types[t])])) as PosSettings["types"],
    countries: Object.fromEntries(SCHENGEN.map((c) => {
      const x = (r.countries?.[c] ?? {}) as Partial<PosCountry>;
      const dc = d.countries[c];
      const provider = POS_PROVIDERS.includes(x.provider as PosProvider) && POS_PROVIDER_INFO[x.provider as PosProvider].countries.includes(c) ? (x.provider as PosProvider) : x.provider === null ? null : dc.provider;
      return [c, { enabled: bool(x.enabled, dc.enabled), stage: x.stage === "PROVIDER" ? "PROVIDER" : "NONFISCAL", provider, fallbackNonFiscal: bool(x.fallbackNonFiscal, dc.fallbackNonFiscal) }];
    })),
    features: Object.fromEntries(POS_FEATURES.map((f) => [f, bool(r.features?.[f], d.features[f])])) as PosSettings["features"],
    offlineHours: int(r.offlineHours, d.offlineHours, 1, 168),
    offlineMaxSales: int(r.offlineMaxSales, d.offlineMaxSales, 10, 5000),
    tillsWithoutApproval: int(r.tillsWithoutApproval, d.tillsWithoutApproval, 0, 100),
  };
}

/** Whether FIRINGI lets a company use the till: master switch, its company type, its country, FIRINGI's own switch for it. */
export function posAllowed(s: PosSettings, c: { type: string; countryCode: string; adminState?: string | null }): { on: boolean; reason: "ok" | "off" | "type" | "country" | "company" } {
  if (c.adminState === "OFF") return { on: false, reason: "company" };
  if (!s.enabled) return { on: false, reason: "off" };
  if (!(POS_TYPES as readonly string[]).includes(c.type)) return { on: false, reason: "type" };
  if (!s.countries[c.countryCode]?.enabled) return { on: false, reason: "country" };
  if (c.adminState === "ON") return { on: true, reason: "ok" };
  return s.types[c.type as PosCompanyType] ? { on: true, reason: "ok" } : { on: false, reason: "type" };
}

/** The till sells in the country's legal currency. */
export const posCurrency = (cc: string): string => (NON_EURO_COUNTRIES as Record<string, string>)[cc] ?? "EUR";
export const posDecimals = (cur: string) => (cur === "ISK" || cur === "HUF" ? 0 : 2);

// ── money ───────────────────────────────────────────────────────────────────

export type PosLineIn = { qty: number | string; unitPrice: number | string; discountPct?: number | string; vatRate: number | string };
export type PosLineOut = { qty: string; unitPrice: string; discountPct: string; vatRate: string; gross: string; net: string; vat: string };

const D = (v: Decimal.Value) => new Decimal(v || 0);

/** One line: prices include VAT; the line is rounded once, then net/VAT split from the gross. */
export function lineTotals(l: PosLineIn, saleDiscountPct: number | string = 0, decimals = 2): PosLineOut {
  const qty = D(l.qty).toDecimalPlaces(3);
  const price = D(l.unitPrice).toDecimalPlaces(4);
  const disc = Decimal.min(100, Decimal.max(0, D(l.discountPct ?? 0)));
  const sale = Decimal.min(100, Decimal.max(0, D(saleDiscountPct)));
  const gross = qty.mul(price).mul(D(1).minus(disc.div(100))).mul(D(1).minus(sale.div(100))).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  const rate = D(l.vatRate);
  const net = gross.div(D(1).plus(rate.div(100))).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
  return { qty: qty.toString(), unitPrice: price.toString(), discountPct: disc.toString(), vatRate: rate.toString(), gross: gross.toFixed(decimals), net: net.toFixed(decimals), vat: gross.minus(net).toFixed(decimals) };
}

export type PosTotals = { gross: string; net: string; vat: string; discount: string; byRate: { rate: string; net: string; vat: string; gross: string }[]; lines: PosLineOut[] };

export function saleTotals(lines: PosLineIn[], saleDiscountPct: number | string = 0, decimals = 2): PosTotals {
  const out = lines.map((l) => lineTotals(l, saleDiscountPct, decimals));
  const before = lines.reduce((a, l) => a.plus(D(l.qty).toDecimalPlaces(3).mul(D(l.unitPrice).toDecimalPlaces(4)).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)), D(0));
  const sum = (k: "gross" | "net" | "vat", arr = out) => arr.reduce((a, l) => a.plus(l[k]), D(0));
  const rates = [...new Set(out.map((l) => D(l.vatRate).toString()))].sort((a, b) => Number(b) - Number(a));
  return {
    gross: sum("gross").toFixed(decimals), net: sum("net").toFixed(decimals), vat: sum("vat").toFixed(decimals),
    discount: Decimal.max(0, before.minus(sum("gross"))).toFixed(decimals),
    byRate: rates.map((r) => { const ls = out.filter((l) => D(l.vatRate).toString() === r); return { rate: r, net: sum("net", ls).toFixed(decimals), vat: sum("vat", ls).toFixed(decimals), gross: sum("gross", ls).toFixed(decimals) }; }),
    lines: out,
  };
}

export type PosPayIn = { method: string; amount: number | string; tendered?: number | string | null };

/** Payments against a total: paid, still due, change (only cash gives change). */
export function settle(gross: number | string, payments: PosPayIn[], decimals = 2) {
  const total = D(gross);
  const nonCash = payments.filter((p) => p.method !== "CASH").reduce((a, p) => a.plus(D(p.amount)), D(0));
  const cashGiven = payments.filter((p) => p.method === "CASH").reduce((a, p) => a.plus(D(p.tendered ?? p.amount)), D(0));
  const cashDue = Decimal.max(0, total.minus(nonCash));
  const paid = nonCash.plus(cashGiven);
  return {
    paid: paid.toFixed(decimals),
    due: Decimal.max(0, total.minus(paid)).toFixed(decimals),
    change: Decimal.max(0, cashGiven.minus(cashDue)).toFixed(decimals),
    cashKept: Decimal.min(cashGiven, cashDue).toFixed(decimals),
    over: nonCash.greaterThan(total.plus(0.001)),
  };
}

/** Cash rounding to 0.05 is not applied: card / exact amounts everywhere (the business can enable it on its own till). */

// ── numbers, chain, points ──────────────────────────────────────────────────

export const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const receiptNumber = (code: string, shift: number, n: number) => `${code}-${pad(shift, 4)}-${pad(n, 4)}`;

/** What each receipt's hash covers (the server keeps the chain per register). */
export const hashInput = (prev: string | null, s: { number: string; soldAt: string; gross: string; lines: { name: string; qty: string; gross: string }[] }) =>
  `${prev ?? ""}|${s.number}|${s.soldAt}|${s.gross}|${s.lines.map((l) => `${l.name}:${l.qty}:${l.gross}`).join(";")}`;

/** Points earned on what was paid in money (points paid with points earn none). */
export const pointsFor = (paidInMoney: number | string, perUnit: number | string) => Math.max(0, Math.floor(D(paidInMoney).mul(D(perUnit)).toNumber()));
export const pointsValue = (points: number, pointValue: number | string, decimals = 2) => D(points).mul(D(pointValue)).toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toFixed(decimals);

// ── recipes and stock ───────────────────────────────────────────────────────

export const RECIPE_UNITS = ["KG", "PCS", "PACK"] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];

/** How much of one purchased pack a recipe quantity is (0.15 KG of a 10 kg box = 0.015). */
export function packsOf(qty: number | string, unit: string, pack: { netWeightKg?: number | string | null; unitsPerPack?: number | string | null }): Decimal {
  const q = D(qty);
  if (unit === "KG") return pack.netWeightKg && D(pack.netWeightKg).gt(0) ? q.div(D(pack.netWeightKg)) : q;
  if (unit === "PCS") return pack.unitsPerPack && D(pack.unitsPerPack).gt(0) ? q.div(D(pack.unitsPerPack)) : q;
  return q;
}

/** Fractions add up; whole packs are taken from stock. */
export function accrue(pending: number | string, add: number | string) {
  const total = D(pending).plus(D(add));
  const whole = Decimal.max(0, total.floor()).toNumber();
  return { whole, pending: total.minus(whole).toDecimalPlaces(6).toString() };
}

/** Days of stock left at the recent rate, and what to order to cover `coverDays`. */
export function reorderHint(left: number, usedPerDay: number, coverDays = 7) {
  if (usedPerDay <= 0) return { daysLeft: null as number | null, suggest: 0 };
  const daysLeft = Math.floor(left / usedPerDay);
  return { daysLeft, suggest: Math.max(0, Math.ceil(usedPerDay * coverDays - left)) };
}

// ── X/Z report ──────────────────────────────────────────────────────────────

export type ZSale = { kind: "SALE" | "REFUND"; status: string; gross: number; net: number; vat: number; discount: number; cashierId: string; payments: { method: string; amount: number }[]; byRate: { rate: number; net: number; vat: number; gross: number }[] };
export type ZCash = { kind: "PAY_IN" | "PAY_OUT" | "NO_SALE"; amount: number };

export function zReport(sales: ZSale[], cash: ZCash[], openingFloat: number, decimals = 2) {
  const r = (n: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;
  const live = sales.filter((s) => s.status === "COMPLETED");
  const sign = (s: ZSale) => (s.kind === "REFUND" ? -1 : 1);
  const byPayment: Record<string, number> = {};
  const byRate = new Map<number, { net: number; vat: number; gross: number }>();
  const byCashier: Record<string, { count: number; gross: number }> = {};
  for (const s of live) {
    for (const p of s.payments) byPayment[p.method] = r((byPayment[p.method] ?? 0) + sign(s) * p.amount);
    for (const x of s.byRate) { const c = byRate.get(x.rate) ?? { net: 0, vat: 0, gross: 0 }; byRate.set(x.rate, { net: r(c.net + sign(s) * x.net), vat: r(c.vat + sign(s) * x.vat), gross: r(c.gross + sign(s) * x.gross) }); }
    const c = byCashier[s.cashierId] ?? { count: 0, gross: 0 };
    byCashier[s.cashierId] = { count: c.count + (s.kind === "SALE" ? 1 : 0), gross: r(c.gross + sign(s) * s.gross) };
  }
  const salesOnly = live.filter((s) => s.kind === "SALE"), refunds = live.filter((s) => s.kind === "REFUND");
  const sum = (arr: ZSale[], k: "gross" | "net" | "vat" | "discount") => r(arr.reduce((a, s) => a + s[k], 0));
  const payIn = r(cash.filter((c) => c.kind === "PAY_IN").reduce((a, c) => a + c.amount, 0));
  const payOut = r(cash.filter((c) => c.kind === "PAY_OUT").reduce((a, c) => a + c.amount, 0));
  return {
    count: salesOnly.length, refundCount: refunds.length, voided: sales.length - live.length,
    gross: r(sum(salesOnly, "gross") - sum(refunds, "gross")), net: r(sum(salesOnly, "net") - sum(refunds, "net")), vat: r(sum(salesOnly, "vat") - sum(refunds, "vat")),
    salesGross: sum(salesOnly, "gross"), refundsGross: sum(refunds, "gross"), discounts: sum(salesOnly, "discount"),
    byPayment, byRate: [...byRate].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, ...v })), byCashier,
    openingFloat: r(openingFloat), payIn, payOut, noSale: cash.filter((c) => c.kind === "NO_SALE").length,
    expectedCash: r(openingFloat + (byPayment.CASH ?? 0) + payIn - payOut),
  };
}
export type ZReport = ReturnType<typeof zReport>;
