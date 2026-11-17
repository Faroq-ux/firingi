/**
 * Catch-weight / sold by weight (Phase 41) — settings and the pure rules (tested in tests/unit/catch-weight.test.ts).
 *
 * Prices stay per unit (the estimate: price per kg × the unit's nominal weight), so carts, promotions and
 * checkout work unchanged. Once weighed, a line is billed on its weight: the "unit equivalent" is
 * billedKg ÷ nominalKg and every per-unit amount (list, discounts, commission, supplier cost) follows it.
 *
 *   PIECE — ordered by piece / pack, each ≈ nominalKg (a whole salmon ≈ 3.5 kg)
 *   KG    — ordered by kilo (a unit = nominalKg, usually 1 kg)
 *
 * Over-weight: the customer pays at most ordered × nominal × (1 + tolerance %) unless they accept more.
 * Under-weight: the customer pays the real weight.
 */
import Decimal from "decimal.js";

export type CatchWeightMode = "PIECE" | "KG";

export type CatchWeightSettings = {
  enabled: boolean;
  /** FIRINGI's over-weight limit (%) — per country, `default` elsewhere. Suppliers can only set a tighter one. */
  maxOverPct: { default: number } & Record<string, number>;
  /** Pay-before-shipping: extra % paid on sold-by-weight lines (unused part stays as credit). */
  prepayBufferPct: number;
  /** The driver may change weights at the stop. */
  driverCorrection: boolean;
  /** Orders with sold-by-weight lines can't be dispatched before every such line is weighed. */
  requireWeighing: boolean;
  /** Scale labels: EAN-13 starting with one of `prefixes`, then the item code, then the weight. */
  ean13: { prefixes: string[]; itemDigits: number; valueDigits: number; gramsPerUnit: number };
};

export const DEFAULT_CATCH_WEIGHT_SETTINGS: CatchWeightSettings = {
  enabled: true,
  maxOverPct: { default: 10 },
  prepayBufferPct: 10,
  driverCorrection: true,
  requireWeighing: false,
  ean13: { prefixes: ["28", "29"], itemDigits: 5, valueDigits: 5, gramsPerUnit: 1 },
};

export function mergeCatchWeightSettings(v: Partial<CatchWeightSettings> | null | undefined): CatchWeightSettings {
  const d = DEFAULT_CATCH_WEIGHT_SETTINGS;
  const x = v ?? {};
  return { ...d, ...x, maxOverPct: { ...d.maxOverPct, ...(x.maxOverPct ?? {}) }, ean13: { ...d.ean13, ...(x.ean13 ?? {}) } };
}

/** The over-weight limit for an offer sold in a country: FIRINGI's, or the supplier's when tighter. */
export function tolerancePct(s: CatchWeightSettings, countryCode: string, supplierPct?: number | null): number {
  const admin = s.maxOverPct[countryCode] ?? s.maxOverPct.default;
  return supplierPct != null && supplierPct >= 0 ? Math.min(admin, supplierPct) : admin;
}

const D = (v: Decimal.Value) => new Decimal(v);
const kg3 = (v: Decimal) => v.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);

export const estimatedKg = (units: number, nominalKg: Decimal.Value) => kg3(D(nominalKg).mul(units));

/**
 * What a weighed line is billed: the real weight, capped at ordered × nominal × (1 + tolerance) unless the
 * customer accepted the extra. Not weighed → the estimate.
 */
export function billedKg(i: { units: number; nominalKg: Decimal.Value; actualKg?: Decimal.Value | null; tolerancePct: number; accepted?: boolean }) {
  const est = estimatedKg(i.units, i.nominalKg);
  const maxKg = kg3(est.mul(D(100).plus(i.tolerancePct)).div(100));
  if (i.actualKg == null) return { billed: est, maxKg, weighed: false, over: false, capped: false };
  const actual = kg3(D(i.actualKg));
  const over = actual.gt(maxKg);
  const capped = over && !i.accepted;
  return { billed: capped ? maxKg : actual, maxKg, weighed: true, over, capped };
}

/** Units the line is billed as (decimal): billed kg ÷ nominal kg. */
export const unitEquivalent = (billed: Decimal.Value, nominalKg: Decimal.Value) => D(billed).div(nominalKg);

export const pricePerKg = (unitPrice: Decimal.Value, nominalKg: Decimal.Value) => D(unitPrice).div(nominalKg).toDecimalPlaces(4);

/** Pay-before-shipping extra on the sold-by-weight lines' gross. */
export const prepayBuffer = (cwGross: Decimal.Value, pct: number) => D(cwGross).mul(pct).div(100).toDecimalPlaces(2, Decimal.ROUND_UP);

/** Weights typed or scanned: kg per piece, each > 0 and < 1000; at most 500 pieces. */
export function cleanPieces(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 500) return null;
  const out: number[] = [];
  for (const x of raw) {
    const v = typeof x === "string" ? Number(x.replace(",", ".")) : Number(x);
    if (!Number.isFinite(v) || v <= 0 || v >= 1000) return null;
    out.push(Math.round(v * 1000) / 1000);
  }
  return out;
}

export const sumKg = (pieces: number[]) => kg3(pieces.reduce((a, x) => a.plus(x), D(0)));

/** "1,5", "1.5 kg", "1500 g" → kg (null when not a weight). */
export function parseKg(text: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|g)?\s*$/i.exec(text);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  const kg = m[2]?.toLowerCase() === "g" ? v / 1000 : v;
  return kg > 0 && kg < 1000 ? Math.round(kg * 1000) / 1000 : null;
}

// ── scale labels ────────────────────────────────────────────────────────────

export type WeightLabel = { kind: "EAN13"; item: string; kg: number; code: string } | { kind: "GS1"; gtin: string | null; kg: number; lot: string | null; code: string };

const gtinOk = (code: string) => {
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};

const FIXED: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
const VARIABLE = new Set(["10", "21", "22", "30", "37", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"]);

/** GS1 element string → AI map. Accepts "(01)…(3103)…", raw with GS (\x1d) separators, and "]C1"/"]d2"/"]Q3" prefixes. */
export function parseGs1(raw: string): Record<string, string> | null {
  let s = raw.trim().replace(/^\](C1|d2|Q3|e0)/, "");
  const out: Record<string, string> = {};
  if (s.startsWith("(")) {
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    let seen = 0;
    while ((m = re.exec(s))) { out[m[1]] = m[2].replace(/\x1d/g, ""); seen += m[0].length; }
    return seen === s.length && Object.keys(out).length ? out : null;
  }
  if (!/^\d{2}/.test(s)) return null;
  while (s.length) {
    const ai2 = s.slice(0, 2);
    if (FIXED[ai2] != null) { out[ai2] = s.slice(2, 2 + FIXED[ai2]); if (out[ai2].length !== FIXED[ai2]) return null; s = s.slice(2 + FIXED[ai2]); }
    else if (/^3[1-6]\d\d/.test(s.slice(0, 4))) { const ai = s.slice(0, 4); out[ai] = s.slice(4, 10); if (out[ai].length !== 6) return null; s = s.slice(10); }
    else if (VARIABLE.has(ai2)) { const end = s.indexOf("\x1d"); out[ai2] = end < 0 ? s.slice(2) : s.slice(2, end); s = end < 0 ? "" : s.slice(end + 1); }
    else return null;
    if (s.startsWith("\x1d")) s = s.slice(1);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * A scale label: EAN-13 variable measure (2x prefix + item code + weight) or GS1-128 / DataMatrix
 * with AI 310n (net weight in kg, n decimals). Null when the code isn't one.
 */
export function parseWeightLabel(raw: string, cfg: CatchWeightSettings["ean13"] = DEFAULT_CATCH_WEIGHT_SETTINGS.ean13): WeightLabel | null {
  const code = raw.trim().replace(/[\r\n\t]/g, "");
  if (/^\d{13}$/.test(code) && cfg.prefixes.some((p) => code.startsWith(p)) && gtinOk(code)) {
    const p = cfg.prefixes.find((x) => code.startsWith(x))!;
    const item = code.slice(p.length, p.length + cfg.itemDigits);
    const value = code.slice(12 - cfg.valueDigits, 12);
    const kg = (Number(value) * cfg.gramsPerUnit) / 1000;
    return kg > 0 ? { kind: "EAN13", item, kg: Math.round(kg * 1000) / 1000, code } : null;
  }
  const ai = parseGs1(code);
  if (!ai) return null;
  const w = Object.keys(ai).find((k) => /^310\d$/.test(k));
  if (!w) return null;
  const kg = Number(ai[w]) / 10 ** Number(w[3]);
  if (!(kg > 0)) return null;
  return { kind: "GS1", gtin: ai["01"] ?? ai["02"] ?? null, kg: Math.round(kg * 1000) / 1000, lot: ai["10"] ?? null, code };
}

/** GTINs are compared as 14 digits (an EAN-13 on the product = its GTIN-14 with a leading 0). */
export const gtin14 = (g: string | null | undefined) => (g && /^\d{8,14}$/.test(g) ? g.padStart(14, "0") : null);
