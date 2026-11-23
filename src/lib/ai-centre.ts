/** AI Centre (Phase 66) — areas, settings and the fuel / energy maths behind route savings. No server imports. Docs: docs/ai-centre.md. */
import type { RecKind } from "./ai";

// ── recommendations: six areas ──────────────────────────────────────────────

export const REC_AREAS = ["SALES", "PRICING", "SUPPLIERS", "STOCK", "CUSTOMERS", "ROUTES"] as const;
export type RecArea = (typeof REC_AREAS)[number];
export const AREA_LABEL: Record<RecArea, string> = { SALES: "Sales", PRICING: "Pricing", SUPPLIERS: "Suppliers", STOCK: "Stock", CUSTOMERS: "Customers", ROUTES: "Delivery routes" };
export const AREA_HINT: Record<RecArea, string> = {
  SALES: "Products and suppliers whose sales are rising fast or dropping.",
  PRICING: "Margins below FIRINGI's rules, prices far from the market, commission to review.",
  SUPPLIERS: "A cheaper or more reliable supplier for what customers buy.",
  STOCK: "Products about to run out at a supplier.",
  CUSTOMERS: "Customers late with their usual order, going quiet, or with overdue invoices.",
  ROUTES: "Delivery routes that can be shorter or combined: fewer kilometres, less fuel or energy, less CO₂.",
};

/** New kinds (Phase 66) alongside Phase 17's. */
export const CENTRE_KINDS = ["SALES_DROP", "PRICE_REVIEW", "COMMISSION_REVIEW", "CUSTOMER_LAPSING", "OVERDUE_PAYMENT", "ROUTE_SAVING", "ROUTE_MERGE", "SERVICE_MISSED", "SERVICE_FREQUENCY", "OIL_CONTAINER_FULL", "PROVIDER_LICENCE", "CUSTOMER_OVERPAYING"] as const;
export type CentreKind = (typeof CENTRE_KINDS)[number];
export type AnyRecKind = RecKind | CentreKind;
export const KIND_AREA: Record<AnyRecKind, RecArea> = {
  DEMAND_SURGE: "SALES", SALES_DROP: "SALES",
  MARGIN_GAP: "PRICING", PRICE_REVIEW: "PRICING", COMMISSION_REVIEW: "PRICING",
  CHEAPER_SUPPLIER: "SUPPLIERS", PROVIDER_LICENCE: "SUPPLIERS",
  STOCK_OUT: "STOCK", LOW_COVER: "STOCK",
  REORDER_DUE: "CUSTOMERS", CUSTOMER_LAPSING: "CUSTOMERS", OVERDUE_PAYMENT: "CUSTOMERS", SERVICE_MISSED: "CUSTOMERS", SERVICE_FREQUENCY: "CUSTOMERS", CUSTOMER_OVERPAYING: "CUSTOMERS",
  DELIVERY_RISK: "ROUTES", ROUTE_SAVING: "ROUTES", ROUTE_MERGE: "ROUTES", OIL_CONTAINER_FULL: "ROUTES",
};
export const CENTRE_KIND_LABEL: Record<CentreKind, string> = {
  SALES_DROP: "Sales dropping", PRICE_REVIEW: "Price to review", COMMISSION_REVIEW: "Commission to review", CUSTOMER_LAPSING: "Customer going quiet",
  OVERDUE_PAYMENT: "Overdue invoices", ROUTE_SAVING: "Shorter route", ROUTE_MERGE: "Combine routes",
  SERVICE_MISSED: "Service visit missed", SERVICE_FREQUENCY: "Service schedule to adjust", OIL_CONTAINER_FULL: "Used oil overflowing", PROVIDER_LICENCE: "Provider licence ending", CUSTOMER_OVERPAYING: "Customer paying above the market",
};
export const kindsOf = (area: RecArea) => (Object.keys(KIND_AREA) as AnyRecKind[]).filter((k) => KIND_AREA[k] === area);

// ── forecasting & reports ───────────────────────────────────────────────────

export const FORECASTS = ["DEMAND", "SALES", "ORDERS", "INVENTORY", "CASH", "DELIVERY"] as const;
export type ForecastKind = (typeof FORECASTS)[number];
export const FORECAST_LABEL: Record<ForecastKind, string> = { DEMAND: "Demand", SALES: "Sales", ORDERS: "Orders", INVENTORY: "Inventory", CASH: "Cash flow", DELIVERY: "Delivery" };

export const REPORTS = ["EXECUTIVE", "SALES", "SUPPLIER", "STOCK", "FINANCE", "DELIVERY_RISK", "FRAUD"] as const;
export type ReportKind = (typeof REPORTS)[number];
export const REPORT_LABEL: Record<ReportKind, string> = { EXECUTIVE: "Executive", SALES: "Sales", SUPPLIER: "Suppliers", STOCK: "Stock", FINANCE: "Finance", DELIVERY_RISK: "Delivery risks", FRAUD: "Fraud & risk alerts" };

// ── fuel & energy ───────────────────────────────────────────────────────────

export const FUEL_KINDS = ["DIESEL", "PETROL", "HYBRID", "LPG", "ELECTRIC"] as const;
export type FuelKind = (typeof FUEL_KINDS)[number];
/** per100: litres (kWh for ELECTRIC) per 100 km; price: € per litre / kWh; co2: kg CO₂ per litre / kWh. */
export type FuelRate = { per100: number; price: number; co2: number };
export const FUEL_UNIT: Record<FuelKind, "L" | "kWh"> = { DIESEL: "L", PETROL: "L", HYBRID: "L", LPG: "L", ELECTRIC: "kWh" };

export type AiCentreSettings = {
  /** areas FIRINGI switched on (off: not computed, not shown) */
  areas: Record<RecArea, boolean>;
  forecasts: Record<ForecastKind, boolean>;
  reports: Record<ReportKind, boolean>;
  fuels: Record<FuelKind, FuelRate>;
  /** vehicles with no fuel set */
  defaultFuel: FuelKind;
  /** a route is worth changing when it saves at least this many km and this share */
  routeMinKm: number;
  routeMinPct: number;
  /** two routes on the same day are worth combining when their areas are within this distance */
  mergeWithinKm: number;
  /** customers going quiet: no order for this many times their usual gap */
  lapseFactor: number;
  /** overdue invoices: flag after this many days */
  overdueDays: number;
  /** weekly executive report by email to FIRINGI admins (Monday morning) */
  weeklyEmail: boolean;
  /** Claude writes the report summaries when the AI is connected (otherwise FIRINGI's own wording) */
  claudeSummaries: boolean;
};

const on = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, true])) as Record<K, boolean>;
export const DEFAULT_AI_CENTRE: AiCentreSettings = {
  areas: on(REC_AREAS), forecasts: on(FORECASTS), reports: on(REPORTS),
  fuels: { DIESEL: { per100: 9, price: 1.65, co2: 2.68 }, PETROL: { per100: 10, price: 1.8, co2: 2.31 }, HYBRID: { per100: 6, price: 1.8, co2: 2.31 }, LPG: { per100: 12, price: 0.95, co2: 1.51 }, ELECTRIC: { per100: 22, price: 0.25, co2: 0.2 } },
  defaultFuel: "DIESEL", routeMinKm: 3, routeMinPct: 8, mergeWithinKm: 15, lapseFactor: 2, overdueDays: 15, weeklyEmail: true, claudeSummaries: true,
};

const num = (x: unknown, lo: number, hi: number, def: number) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const flags = <K extends string>(keys: readonly K[], v: unknown, d: Record<K, boolean>) => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, typeof o[k] === "boolean" ? (o[k] as boolean) : d[k]])) as Record<K, boolean>;
};

export function mergeAiCentre(v: Partial<AiCentreSettings> | null | undefined): AiCentreSettings {
  const d = DEFAULT_AI_CENTRE;
  const s = (v && typeof v === "object" ? v : {}) as Partial<AiCentreSettings>;
  const fu = (s.fuels ?? {}) as Partial<Record<FuelKind, Partial<FuelRate>>>;
  return {
    areas: flags(REC_AREAS, s.areas, d.areas), forecasts: flags(FORECASTS, s.forecasts, d.forecasts), reports: flags(REPORTS, s.reports, d.reports),
    fuels: Object.fromEntries(FUEL_KINDS.map((k) => [k, { per100: num(fu[k]?.per100, 0.1, 200, d.fuels[k].per100), price: num(fu[k]?.price, 0, 50, d.fuels[k].price), co2: num(fu[k]?.co2, 0, 10, d.fuels[k].co2) }])) as Record<FuelKind, FuelRate>,
    defaultFuel: FUEL_KINDS.includes(s.defaultFuel as FuelKind) ? (s.defaultFuel as FuelKind) : d.defaultFuel,
    routeMinKm: num(s.routeMinKm, 0.5, 100, d.routeMinKm), routeMinPct: num(s.routeMinPct, 1, 80, d.routeMinPct), mergeWithinKm: num(s.mergeWithinKm, 1, 200, d.mergeWithinKm),
    lapseFactor: num(s.lapseFactor, 1.2, 10, d.lapseFactor), overdueDays: Math.round(num(s.overdueDays, 1, 180, d.overdueDays)),
    weeklyEmail: typeof s.weeklyEmail === "boolean" ? s.weeklyEmail : d.weeklyEmail, claudeSummaries: typeof s.claudeSummaries === "boolean" ? s.claudeSummaries : d.claudeSummaries,
  };
}

export const fuelOf = (vehicleFuel: string | null | undefined, s: Pick<AiCentreSettings, "defaultFuel">): FuelKind => (FUEL_KINDS.includes(vehicleFuel as FuelKind) ? (vehicleFuel as FuelKind) : s.defaultFuel);

const r2 = (n: number) => Math.round(n * 100) / 100;
/** What `km` costs in fuel / energy, money and CO₂ for a vehicle on `fuel`. */
export function tripCost(km: number, fuel: FuelKind, s: Pick<AiCentreSettings, "fuels">) {
  const f = s.fuels[fuel];
  const amount = (Math.max(0, km) * f.per100) / 100;
  return { km: r2(km), fuel, unit: FUEL_UNIT[fuel], amount: r2(amount), cost: r2(amount * f.price), co2Kg: r2(amount * f.co2) };
}

/** Is a shorter route worth suggesting? */
export const worthIt = (currentKm: number, betterKm: number, s: Pick<AiCentreSettings, "routeMinKm" | "routeMinPct">) =>
  currentKm > 0 && currentKm - betterKm >= s.routeMinKm && ((currentKm - betterKm) / currentKm) * 100 >= s.routeMinPct;

/** Week-by-week sums of dated values (oldest first), `weeks` long, ending with the week before `now`. */
export function weekly(rows: { at: Date; v: number }[], weeks: number, now: Date) {
  const end = startOfWeek(now).getTime();
  const out = Array.from({ length: weeks }, () => 0);
  for (const r of rows) {
    const w = Math.floor((end - r.at.getTime()) / (7 * 86400_000));
    if (r.at.getTime() < end && w >= 0 && w < weeks) out[weeks - 1 - w] += r.v;
  }
  return out.map(r2);
}
/** Monday 00:00 UTC of the week of `d`. */
export function startOfWeek(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** Change between the last `n` and the `n` before, as a fraction (null without a base). */
export function change(series: number[], n: number) {
  const last = series.slice(-n).reduce((a, b) => a + b, 0), prev = series.slice(-2 * n, -n).reduce((a, b) => a + b, 0);
  return prev > 0 ? r2((last - prev) / prev) : null;
}
