/**
 * Buying from several wholesalers — pure rules shared by server and pages:
 *  1. Supplier minimums: where a supplier in the cart stands against its minimum order (FIRINGI's minimum for a
 *     customer, the supplier's free-delivery minimum, a distributor's minimum for a wholesaler), so search results can
 *     put suppliers already in the cart first and say "€12 more to reach the minimum", and the cart can suggest what
 *     the customer usually buys from that supplier.
 *  2. Supplier names: FIRINGI decides whether buyers see the wholesaler's name or "FIRINGI <area>" (e.g. FIRINGI Almada)
 *     — per buyer country, for wholesalers buying from distributors, and per supplier.
 */
import Decimal from "decimal.js";
import type { FiringiRule, VendorRule } from "@/server/orders/delivery-rule";

// ── 1. supplier minimums ─────────────────────────────────────────────────────

export type CartHelpSettings = {
  enabled: boolean;
  /** suppliers already in the cart (then the usual ones) first in search and scan results */
  cartFirst: boolean;
  /** "In your cart · €12 more to reach the minimum" / "Minimum order €100" on results */
  badges: boolean;
  /** in the cart: what the customer usually buys from a supplier below its minimum, one tap to add */
  suggestions: boolean;
  /** countries (buyer's) where it is off */
  offCountries: string[];
};
export const CART_HELP_DEFAULTS: CartHelpSettings = { enabled: true, cartFirst: true, badges: true, suggestions: true, offCountries: [] };

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const codes = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c)).map((c) => c.toUpperCase()))];

export function mergeCartHelp(v: Partial<CartHelpSettings> | null | undefined): CartHelpSettings {
  const s = v ?? {}, d = CART_HELP_DEFAULTS;
  return { enabled: bool(s.enabled, d.enabled), cartFirst: bool(s.cartFirst, d.cartFirst), badges: bool(s.badges, d.badges), suggestions: bool(s.suggestions, d.suggestions), offCountries: codes(s.offCountries) };
}
export const cartHelpOn = (s: CartHelpSettings, countryCode: string) => s.enabled && !s.offCountries.includes(countryCode.toUpperCase());

/**
 * Where a supplier stands for this buyer:
 *  - MINIMUM: below a minimum that blocks checkout (FIRINGI's minimum order; a distributor's minimum without a flat fee)
 *  - FREE:    the order goes through, but below the supplier's free-delivery minimum (a delivery fee is charged)
 *  - REACHED: the minimum / free delivery is reached
 *  - NONE:    no minimum to reach
 */
export type Standing = { state: "MINIMUM" | "FREE" | "REACHED" | "NONE"; unit: "AMOUNT" | "UNITS"; target: string | null; missing: string | null };

export function standing(i: { wholesaler: boolean; goodsNet: Decimal.Value; units: number; firingi: FiringiRule; vendor: VendorRule }): Standing {
  const goods = new Decimal(i.goodsNet);
  const v = i.vendor;
  const byUnits = v?.kind === "UNITS" && v.units != null && v.units > 0;
  const vAmount = !byUnits && v?.amount != null ? new Decimal(v.amount) : null;
  const vTarget = byUnits ? new Decimal(v!.units!) : vAmount;
  const vHave = byUnits ? new Decimal(i.units) : goods;
  const unit: Standing["unit"] = byUnits ? "UNITS" : "AMOUNT";
  const out = (state: Standing["state"], target: Decimal | null, have: Decimal, u: Standing["unit"] = unit): Standing => ({
    state, unit: u, target: target ? (u === "UNITS" ? target.toString() : target.toFixed(2)) : null,
    missing: target && target.gt(have) ? (u === "UNITS" ? target.minus(have).toString() : target.minus(have).toFixed(2)) : null,
  });
  if (i.wholesaler) {
    if (!vTarget) return out("NONE", null, vHave);
    if (vHave.gte(vTarget)) return out("REACHED", vTarget, vHave);
    return out(v?.flatFeeNet != null ? "FREE" : "MINIMUM", vTarget, vHave);
  }
  const fMin = i.firingi ? new Decimal(i.firingi.minOrderValue) : new Decimal(0);
  if (vTarget && vHave.gte(vTarget)) return out("REACHED", vTarget, vHave);
  if (fMin.gt(0) && goods.lt(fMin)) return out("MINIMUM", fMin, goods, "AMOUNT");
  if (vTarget) return out("FREE", vTarget, vHave);
  return out(fMin.gt(0) ? "REACHED" : "NONE", fMin.gt(0) ? fMin : null, goods, "AMOUNT");
}

/** Search / scan results: suppliers in the cart first, then the buyer's usual suppliers, else as given (stable). */
export function cartFirst<T extends { vendor: { id: string } }>(items: T[], inCart: Set<string>, usual: string[]): T[] {
  const rank = (id: string) => (inCart.has(id) ? 0 : usual.includes(id) ? 1 + usual.indexOf(id) / 1000 : 2);
  return items.map((x, k) => ({ x, k })).sort((a, b) => rank(a.x.vendor.id) - rank(b.x.vendor.id) || a.k - b.k).map((p) => p.x);
}

// ── 2. supplier names ────────────────────────────────────────────────────────

export type NameMode = "NAME" | "AREA";
export type SupplierNameSettings = {
  /** what customers see by default */
  customers: NameMode;
  /** per customer country (overrides the default) */
  countries: Record<string, NameMode>;
  /** what wholesalers buying from distributors see */
  wholesalers: NameMode;
  /** per supplier (wins over everything) */
  companies: Record<string, NameMode>;
};
export const SUPPLIER_NAME_DEFAULTS: SupplierNameSettings = { customers: "NAME", countries: {}, wholesalers: "NAME", companies: {} };
const mode = (v: unknown, d: NameMode): NameMode => (v === "NAME" || v === "AREA" ? v : d);

export function mergeSupplierNames(v: Partial<SupplierNameSettings> | null | undefined): SupplierNameSettings {
  const s = v ?? {}, d = SUPPLIER_NAME_DEFAULTS;
  const map = (m: unknown, key: (k: string) => boolean) => Object.fromEntries(Object.entries((m ?? {}) as Record<string, unknown>).filter(([k, x]) => key(k) && (x === "NAME" || x === "AREA"))) as Record<string, NameMode>;
  return {
    customers: mode(s.customers, d.customers), wholesalers: mode(s.wholesalers, d.wholesalers),
    countries: Object.fromEntries(Object.entries(map(s.countries, (k) => /^[A-Za-z]{2}$/.test(k))).map(([k, x]) => [k.toUpperCase(), x])),
    companies: map(s.companies, (k) => k.length > 0 && k.length < 60),
  };
}

/** Does this buyer see the supplier's name or "FIRINGI <area>"? */
export function nameModeFor(s: SupplierNameSettings, buyer: { type: string; countryCode: string }, vendorId: string): NameMode {
  const o = s.companies[vendorId];
  if (o) return o;
  if (buyer.type === "WHOLESALER") return s.wholesalers;
  if (buyer.type !== "CUSTOMER") return "NAME";
  return s.countries[buyer.countryCode.toUpperCase()] ?? s.customers;
}

/**
 * "FIRINGI <area>" labels for every supplier: the city of its warehouse (else pickup point, else head office);
 * suppliers sharing a city are numbered in the order they joined ("FIRINGI Almada", "FIRINGI Almada 2").
 */
export function areaLabels(vendors: { id: string; createdAt: Date; city: string | null }[]): Map<string, string> {
  const byCity = new Map<string, { id: string; createdAt: Date }[]>();
  for (const v of vendors) {
    const c = (v.city ?? "").trim();
    const key = c.toLocaleLowerCase();
    byCity.set(key, [...(byCity.get(key) ?? []), v]);
  }
  const out = new Map<string, string>();
  for (const v of vendors) {
    const c = (v.city ?? "").trim();
    const list = [...byCity.get(c.toLocaleLowerCase())!].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const n = list.findIndex((x) => x.id === v.id) + 1;
    out.set(v.id, `FIRINGI${c ? ` ${c}` : ""}${n > 1 ? ` ${n}` : ""}`);
  }
  return out;
}

/** Standing with `target` / `missing` formatted for display (money for amounts, a count for units). */
export function formatStanding<T extends Standing>(s: T, money: (amount: string) => string): T {
  const f = (x: string | null) => (x == null ? null : s.unit === "UNITS" ? x : money(x));
  return { ...s, target: f(s.target), missing: f(s.missing) };
}
