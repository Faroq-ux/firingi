/**
 * Licensed & excise goods (Phase 43) — settings and the pure rules: what one sold unit measures (litres,
 * litres of pure alcohol, units, kg, ml), the duty on it for a rate, sugar bands, what is missing for a basis.
 */
import Decimal from "decimal.js";

export type ExciseKind = "ALCOHOL" | "TOBACCO" | "VAPING" | "SUGAR";
export type ExciseBasis = "HL_PURE_ALCOHOL" | "HL_PER_ABV" | "HL_PRODUCT" | "THOUSAND_UNITS" | "KG" | "ML" | "HL_SUGAR_BAND";
export type DutyMode = "PAID" | "ADDED";
export const KINDS: ExciseKind[] = ["ALCOHOL", "TOBACCO", "VAPING", "SUGAR"];
/** Kinds a customer needs a licence for (sugary drinks need none). */
export const LICENSED_KINDS: ExciseKind[] = ["ALCOHOL", "TOBACCO", "VAPING"];

export type Enforcement = "BLOCK" | "WARN";
export type ExciseSettings = {
  enabled: boolean;
  kinds: Record<ExciseKind, boolean>;
  licences: {
    /** customers need an approved licence for licensed kinds */
    buyer: boolean;
    /** without one: BLOCK = can't order (badge + refused at checkout); WARN = told, can still order */
    enforcement: Enforcement;
    /** per buyer country: switch the requirement off or change the enforcement */
    countries: Record<string, { buyer?: boolean; enforcement?: Enforcement }>;
    /** suppliers need their excise authorisation (Phase 28 certificate, required) */
    supplier: boolean;
    reminderDays: number[];
  };
  duty: {
    /** show the excise in the price on invoices, cart and order pages */
    show: boolean;
    /** suppliers may let FIRINGI calculate the duty and add it as its own line */
    calculate: boolean;
  };
  restrictions: { countries: boolean; qtyCaps: boolean; driverCheck: boolean };
  records: { report: boolean; register: boolean; accounting: boolean; deliveryDocs: boolean };
};

export const DEFAULT_EXCISE_SETTINGS: ExciseSettings = {
  enabled: true,
  kinds: { ALCOHOL: true, TOBACCO: true, VAPING: true, SUGAR: true },
  licences: { buyer: true, enforcement: "BLOCK", countries: {}, supplier: false, reminderDays: [30, 14, 7] },
  duty: { show: true, calculate: true },
  restrictions: { countries: true, qtyCaps: true, driverCheck: false },
  records: { report: true, register: true, accounting: true, deliveryDocs: true },
};

const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
export function mergeExciseSettings(raw: unknown): ExciseSettings {
  const r = (raw ?? {}) as Partial<ExciseSettings> & Record<string, Record<string, unknown>>;
  const d = DEFAULT_EXCISE_SETTINGS;
  const k = (r.kinds ?? {}) as Partial<Record<ExciseKind, boolean>>;
  const l = (r.licences ?? {}) as Partial<ExciseSettings["licences"]>;
  const countries: ExciseSettings["licences"]["countries"] = {};
  for (const [code, v] of Object.entries(l.countries ?? {}))
    if (/^[A-Z]{2}$/.test(code) && v && typeof v === "object")
      countries[code] = { ...(typeof v.buyer === "boolean" ? { buyer: v.buyer } : {}), ...(v.enforcement === "BLOCK" || v.enforcement === "WARN" ? { enforcement: v.enforcement } : {}) };
  const days = Array.isArray(l.reminderDays) ? [...new Set(l.reminderDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 120))].sort((x, y) => y - x) : d.licences.reminderDays;
  return {
    enabled: b(r.enabled, d.enabled),
    kinds: Object.fromEntries(KINDS.map((x) => [x, b(k[x], d.kinds[x])])) as Record<ExciseKind, boolean>,
    licences: { buyer: b(l.buyer, d.licences.buyer), enforcement: l.enforcement === "WARN" ? "WARN" : "BLOCK", countries, supplier: b(l.supplier, d.licences.supplier), reminderDays: days.length ? days.slice(0, 5) : d.licences.reminderDays },
    duty: { show: b(r.duty?.show, d.duty.show), calculate: b(r.duty?.calculate, d.duty.calculate) },
    restrictions: { countries: b(r.restrictions?.countries, d.restrictions.countries), qtyCaps: b(r.restrictions?.qtyCaps, d.restrictions.qtyCaps), driverCheck: b(r.restrictions?.driverCheck, d.restrictions.driverCheck) },
    records: { report: b(r.records?.report, d.records.report), register: b(r.records?.register, d.records.register), accounting: b(r.records?.accounting, d.records.accounting), deliveryDocs: b(r.records?.deliveryDocs, d.records.deliveryDocs) },
  };
}

/** Licence rule for a buyer country: needed? and what happens without one. */
export function licenceRule(s: ExciseSettings, countryCode: string) {
  const c = s.licences.countries[countryCode] ?? {};
  return { needed: s.enabled && (c.buyer ?? s.licences.buyer), enforcement: c.enforcement ?? s.licences.enforcement };
}

export type Measures = { abv?: number | null; volumeL?: number | null; exciseUnits?: number | null; netKg?: number | null; sugarGPerL?: number | null };
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** What one sold unit measures, for the report and the duty. */
export function measure(m: Measures) {
  const litres = n(m.volumeL), abv = n(m.abv);
  return {
    litres,
    lpa: litres != null && abv != null ? +(litres * abv / 100).toFixed(4) : null, // litres of pure alcohol
    units: n(m.exciseUnits),
    kg: n(m.netKg),
    ml: litres != null ? +(litres * 1000).toFixed(1) : null,
    abv,
    sugarGPerL: n(m.sugarGPerL),
  };
}

/** Measures a basis needs (to tell the supplier what is missing). */
export function requiredFor(basis: ExciseBasis): (keyof Measures)[] {
  switch (basis) {
    case "HL_PURE_ALCOHOL": case "HL_PER_ABV": return ["volumeL", "abv"];
    case "HL_PRODUCT": case "ML": return ["volumeL"];
    case "THOUSAND_UNITS": return ["exciseUnits"];
    case "KG": return ["netKg"];
    case "HL_SUGAR_BAND": return ["volumeL", "sugarGPerL"];
  }
}
export const missingFor = (basis: ExciseBasis, m: Measures) => requiredFor(basis).filter((k) => m[k] == null || (m[k] as unknown) === "");

export type Band = { maxGPerL: number | null; perHl: number };
export function parseBands(raw: unknown): Band[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => ({ maxGPerL: x?.maxGPerL == null ? null : Number(x.maxGPerL), perHl: Number(x?.perHl) }))
    .filter((x) => Number.isFinite(x.perHl) && x.perHl >= 0 && (x.maxGPerL == null || Number.isFinite(x.maxGPerL)))
    .sort((a, c) => (a.maxGPerL ?? Infinity) - (c.maxGPerL ?? Infinity));
}
/** The band a sugar content falls in: the first whose maximum is above it (the open band last). */
export const bandFor = (bands: Band[], g: number) => bands.find((x) => x.maxGPerL == null || g < x.maxGPerL) ?? null;

export type RateRow = { rate: Decimal.Value; adValoremPct?: Decimal.Value | null; bands?: unknown };

/**
 * Duty on ONE sold unit (4 decimals). Null when a measure the basis needs is missing.
 * Tobacco ad valorem is a % of the unit price (net), on top of the specific duty.
 */
export function dutyPerUnit(basis: ExciseBasis, r: RateRow, m: Measures, unitPriceNet: Decimal.Value = 0): Decimal | null {
  const x = measure(m);
  const rate = new Decimal(r.rate.toString());
  let d: Decimal;
  switch (basis) {
    case "HL_PURE_ALCOHOL": if (x.lpa == null) return null; d = rate.mul(x.lpa).div(100); break;
    case "HL_PER_ABV": if (x.litres == null || x.abv == null) return null; d = rate.mul(x.litres).div(100).mul(x.abv); break;
    case "HL_PRODUCT": if (x.litres == null) return null; d = rate.mul(x.litres).div(100); break;
    case "THOUSAND_UNITS": if (x.units == null) return null; d = rate.mul(x.units).div(1000); break;
    case "KG": if (x.kg == null) return null; d = rate.mul(x.kg); break;
    case "ML": if (x.ml == null) return null; d = rate.mul(x.ml); break;
    case "HL_SUGAR_BAND": {
      if (x.litres == null || x.sugarGPerL == null) return null;
      const band = bandFor(parseBands(r.bands), x.sugarGPerL);
      d = band ? new Decimal(band.perHl).mul(x.litres).div(100) : new Decimal(0);
      break;
    }
  }
  if (r.adValoremPct != null && (basis === "THOUSAND_UNITS" || basis === "KG")) d = d.plus(new Decimal(unitPriceNet.toString()).mul(r.adValoremPct.toString()).div(100));
  return d.toDecimalPlaces(4);
}

/** Rate valid on a day (the newest that started on or before it and hasn't ended). */
export function rateOn<T extends { validFrom: Date; validTo: Date | null }>(rates: T[], at: Date): T | null {
  const day = at.toISOString().slice(0, 10);
  return [...rates].filter((r) => r.validFrom.toISOString().slice(0, 10) <= day && (!r.validTo || r.validTo.toISOString().slice(0, 10) >= day))
    .sort((a, c) => c.validFrom.getTime() - a.validFrom.getTime())[0] ?? null;
}

/** A licence counts when approved, not superseded and not expired on the day. */
export function licenceValid(l: { status: string; expiresOn: Date | null; supersededAt?: Date | null }, at = new Date()) {
  return l.status === "APPROVED" && !l.supersededAt && (!l.expiresOn || l.expiresOn.toISOString().slice(0, 10) >= at.toISOString().slice(0, 10));
}

/** Days until a licence expires (negative = expired). */
export const daysLeft = (expiresOn: Date, at = new Date()) => Math.floor((Date.UTC(expiresOn.getUTCFullYear(), expiresOn.getUTCMonth(), expiresOn.getUTCDate()) - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())) / 86_400_000);

/** "2026-11" → [first day, first day of next month) in UTC. */
export function monthRange(ym: string): [Date, Date] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return [new Date(Date.UTC(y, mo - 1, 1)), new Date(Date.UTC(y, mo, 1))];
}
