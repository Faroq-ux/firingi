/**
 * EU trade reporting (Phase 57) — settings and the pure rules: reporting periods and deadlines, CN8 codes,
 * aggregation of return lines and the file layouts (generic, Portugal, Spain, France, Germany).
 *
 * The national layouts follow each authority's published field list. Before the first real filing in a
 * country, upload one test file to that authority's portal and compare (see docs/eu-trade.md).
 */

export type TradeKind = "ECSL" | "ARRIVALS" | "DISPATCHES";
export const TRADE_KINDS: TradeKind[] = ["ECSL", "ARRIVALS", "DISPATCHES"];
export type TradeFormat = "GENERIC" | "PT" | "ES" | "FR" | "DE";
export const TRADE_FORMATS: TradeFormat[] = ["GENERIC", "PT", "ES", "FR", "DE"];
export type Frequency = "MONTHLY" | "QUARTERLY";
export type Indicator = "GOODS" | "TRIANGULAR" | "SERVICES";

export type TradeCountry = {
  /** EC Sales List: monthly, or quarterly while goods stay under the national limit */
  ecslPeriod: Frequency;
  /** day of the month after the period the return is due */
  ecslDueDay: number;
  intrastatDueDay: number;
  /** € per calendar year; 0 = no exemption threshold (the authority says who must file) */
  arrivalsThreshold: number;
  dispatchesThreshold: number;
  /** FIRINGI must file Intrastat for this flow (over the threshold, or told by the authority) */
  arrivalsObliged: boolean;
  dispatchesObliged: boolean;
  format: TradeFormat;
};

export type TradeSettings = {
  enabled: boolean;
  returns: { ecsl: boolean; arrivals: boolean; dispatches: boolean; supplierReports: boolean };
  /** the main FIRINGI entity may invoice buyers in EU countries where FIRINGI has no entity (exempt intra-EU supply) */
  crossBorderSales: boolean;
  vies: {
    /** check the buyer's VAT number at VIES before invoicing without VAT */
    recheck: boolean;
    /** a VALID check younger than this is reused */
    maxAgeDays: number;
    /** VIES down: charge local VAT, or rely on the last valid check */
    onError: "LOCAL_VAT" | "LAST_VALID";
  };
  codes: {
    /** suppliers can give CN8 code, net mass, supplementary units and origin per product (FIRINGI checks) */
    supplierProposals: boolean;
    /** use the category's CN8 code when a product has none (flagged as a default) */
    categoryDefault: boolean;
  };
  thresholds: { watch: boolean; warnAtPct: number };
  reminders: { enabled: boolean; days: number[] };
  corrections: boolean;
  defaults: { natureCode: string; transportMode: string; deliveryTerms: string };
  countries: Record<string, TradeCountry>;
};

const C = (ecslDueDay: number, intrastatDueDay: number, arrivals: number, dispatches: number, format: TradeFormat, ecslPeriod: Frequency = "MONTHLY"): TradeCountry => ({
  ecslPeriod, ecslDueDay, intrastatDueDay, arrivalsThreshold: arrivals, dispatchesThreshold: dispatches, arrivalsObliged: false, dispatchesObliged: false, format,
});

/** Starting values (2026). Thresholds change most years — check them with each statistics office every January. */
export const DEFAULT_COUNTRIES: Record<string, TradeCountry> = {
  PT: C(20, 15, 650_000, 600_000, "PT"),
  ES: C(20, 12, 400_000, 400_000, "ES"),
  FR: C(10, 10, 0, 0, "FR"),
  DE: C(25, 10, 3_000_000, 1_000_000, "DE"),
};
export const GENERIC_COUNTRY: TradeCountry = C(20, 15, 0, 0, "GENERIC");

export const DEFAULT_TRADE_SETTINGS: TradeSettings = {
  enabled: true,
  returns: { ecsl: true, arrivals: true, dispatches: true, supplierReports: true },
  crossBorderSales: true,
  vies: { recheck: true, maxAgeDays: 30, onError: "LOCAL_VAT" },
  codes: { supplierProposals: true, categoryDefault: true },
  thresholds: { watch: true, warnAtPct: 80 },
  reminders: { enabled: true, days: [7, 3, 1] },
  corrections: true,
  defaults: { natureCode: "11", transportMode: "3", deliveryTerms: "DAP" },
  countries: DEFAULT_COUNTRIES,
};

const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const n = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : d);
const s = (v: unknown, d: string, re: RegExp) => (typeof v === "string" && re.test(v) ? v : d);

export function countrySettings(s: TradeSettings, code: string): TradeCountry {
  return s.countries[code] ?? DEFAULT_COUNTRIES[code] ?? GENERIC_COUNTRY;
}

function mergeCountry(raw: unknown, d: TradeCountry): TradeCountry {
  const r = (raw ?? {}) as Partial<TradeCountry>;
  return {
    ecslPeriod: r.ecslPeriod === "QUARTERLY" || r.ecslPeriod === "MONTHLY" ? r.ecslPeriod : d.ecslPeriod,
    ecslDueDay: n(r.ecslDueDay, d.ecslDueDay, 1, 28),
    intrastatDueDay: n(r.intrastatDueDay, d.intrastatDueDay, 1, 28),
    arrivalsThreshold: n(r.arrivalsThreshold, d.arrivalsThreshold, 0, 1e10),
    dispatchesThreshold: n(r.dispatchesThreshold, d.dispatchesThreshold, 0, 1e10),
    arrivalsObliged: b(r.arrivalsObliged, d.arrivalsObliged),
    dispatchesObliged: b(r.dispatchesObliged, d.dispatchesObliged),
    format: TRADE_FORMATS.includes(r.format as TradeFormat) ? (r.format as TradeFormat) : d.format,
  };
}

export function mergeTradeSettings(raw: unknown): TradeSettings {
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const d = DEFAULT_TRADE_SETTINGS;
  const g = <T extends object>(k: string) => ((r[k] && typeof r[k] === "object" ? r[k] : {}) as Partial<T>);
  const rt = g<TradeSettings["returns"]>("returns"), v = g<TradeSettings["vies"]>("vies"), c = g<TradeSettings["codes"]>("codes");
  const th = g<TradeSettings["thresholds"]>("thresholds"), rm = g<TradeSettings["reminders"]>("reminders"), df = g<TradeSettings["defaults"]>("defaults");
  const countries: Record<string, TradeCountry> = {};
  for (const [code, def] of Object.entries(DEFAULT_COUNTRIES)) countries[code] = def;
  for (const [code, val] of Object.entries(g<Record<string, unknown>>("countries")))
    if (/^[A-Z]{2}$/.test(code)) countries[code] = mergeCountry(val, DEFAULT_COUNTRIES[code] ?? GENERIC_COUNTRY);
  const days = Array.isArray(rm.days) ? [...new Set(rm.days.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 60))].sort((x, y) => y - x).slice(0, 5) : d.reminders.days;
  return {
    enabled: b(r.enabled, d.enabled),
    returns: { ecsl: b(rt.ecsl, d.returns.ecsl), arrivals: b(rt.arrivals, d.returns.arrivals), dispatches: b(rt.dispatches, d.returns.dispatches), supplierReports: b(rt.supplierReports, d.returns.supplierReports) },
    crossBorderSales: b(r.crossBorderSales, d.crossBorderSales),
    vies: { recheck: b(v.recheck, d.vies.recheck), maxAgeDays: n(v.maxAgeDays, d.vies.maxAgeDays, 0, 365), onError: v.onError === "LAST_VALID" || v.onError === "LOCAL_VAT" ? v.onError : d.vies.onError },
    codes: { supplierProposals: b(c.supplierProposals, d.codes.supplierProposals), categoryDefault: b(c.categoryDefault, d.codes.categoryDefault) },
    thresholds: { watch: b(th.watch, d.thresholds.watch), warnAtPct: n(th.warnAtPct, d.thresholds.warnAtPct, 1, 100) },
    reminders: { enabled: b(rm.enabled, d.reminders.enabled), days },
    corrections: b(r.corrections, d.corrections),
    defaults: {
      natureCode: s(df.natureCode, d.defaults.natureCode, /^\d{1,2}$/),
      transportMode: s(df.transportMode, d.defaults.transportMode, /^\d$/),
      deliveryTerms: s(df.deliveryTerms, d.defaults.deliveryTerms, /^[A-Z]{3}$/),
    },
    countries,
  };
}

/** Strict check of what FIRINGI saves (the merge above only repairs stored values). */
export function checkTradeSettings(x: TradeSettings): string | null {
  if (!/^\d{1,2}$/.test(x.defaults.natureCode)) return "Nature of transaction: one or two digits (e.g. 11).";
  if (!/^\d$/.test(x.defaults.transportMode)) return "Mode of transport: one digit (3 = road).";
  if (!/^[A-Z]{3}$/.test(x.defaults.deliveryTerms)) return "Delivery terms: an Incoterm such as DAP.";
  if (x.vies.maxAgeDays < 0 || x.vies.maxAgeDays > 365) return "VIES check age: 0 to 365 days.";
  for (const [code, c] of Object.entries(x.countries)) {
    if (!/^[A-Z]{2}$/.test(code)) return `Unknown country ${code}.`;
    if (c.ecslDueDay < 1 || c.ecslDueDay > 28 || c.intrastatDueDay < 1 || c.intrastatDueDay > 28) return `${code}: due days must be 1 to 28.`;
    if (c.arrivalsThreshold < 0 || c.dispatchesThreshold < 0) return `${code}: thresholds can't be negative.`;
  }
  return null;
}

// ── periods and deadlines ──

const pad = (x: number) => String(x).padStart(2, "0");
/** "2026-11" for a month, "2026-Q4" for a quarter. */
export function periodOf(at: Date, f: Frequency) {
  const y = at.getUTCFullYear(), m = at.getUTCMonth();
  return f === "QUARTERLY" ? `${y}-Q${Math.floor(m / 3) + 1}` : `${y}-${pad(m + 1)}`;
}
export function isPeriod(p: string) { return /^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/.test(p); }
/** [start, end) of a period in UTC. */
export function periodRange(p: string) {
  if (!isPeriod(p)) throw new Error(`BAD_PERIOD:${p}`);
  const y = Number(p.slice(0, 4));
  const q = /Q(\d)$/.exec(p);
  const m0 = q ? (Number(q[1]) - 1) * 3 : Number(p.slice(5, 7)) - 1;
  return { start: new Date(Date.UTC(y, m0, 1)), end: new Date(Date.UTC(y, m0 + (q ? 3 : 1), 1)) };
}
export function frequencyOf(p: string): Frequency { return p.includes("Q") ? "QUARTERLY" : "MONTHLY"; }
/** Due on `dueDay` of the month after the period. */
export function dueOn(p: string, dueDay: number) {
  const { end } = periodRange(p);
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(28, Math.max(1, dueDay))));
}
export function previousPeriod(p: string) {
  const { start } = periodRange(p);
  return periodOf(new Date(start.getTime() - 86400000), frequencyOf(p));
}
export function nextPeriod(p: string) { return periodOf(periodRange(p).end, frequencyOf(p)); }
export const daysUntil = (d: Date, at: Date) => Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())) / 86400000);

// ── codes and numbers ──

/** "2202 10 00" → "22021000"; null when it isn't 8 digits. */
export function normaliseCn(v: string | null | undefined) {
  const c = (v ?? "").replace(/[\s.\-]/g, "");
  return /^\d{8}$/.test(c) ? c : null;
}
export const formatCn = (c: string) => `${c.slice(0, 4)} ${c.slice(4, 6)} ${c.slice(6, 8)}`;
/** VIES prefix of a country: Greece is EL. */
export const vatPrefix = (country: string) => (country === "GR" ? "EL" : country);
/** VAT number with its prefix, no spaces (PT517000008). */
export function vatWithPrefix(vat: string | null | undefined, country: string) {
  if (!vat) return null;
  const v = vat.replace(/[\s.\-]/g, "").toUpperCase();
  const p = vatPrefix(country);
  return /^[A-Z]{2}/.test(v) ? v : `${p}${v}`;
}
/** The number part only (Modelo 349 and some portals want the country separately). */
export const vatNumberPart = (vat: string) => vat.replace(/^[A-Z]{2}/, "");

export type Problem = "MISSING_CN" | "BAD_CN" | "CATEGORY_CN" | "MISSING_MASS" | "MISSING_ORIGIN" | "MISSING_VAT" | "VAT_NOT_VALID";
/** Problems that stop a file being right (CATEGORY_CN is a warning: the category's default code was used). */
export const BLOCKING: Problem[] = ["MISSING_CN", "BAD_CN", "MISSING_MASS", "MISSING_VAT", "VAT_NOT_VALID"];
export const PROBLEM_TEXT: Record<Problem, string> = {
  MISSING_CN: "No CN8 code", BAD_CN: "CN8 code isn't 8 digits", CATEGORY_CN: "Category's default CN8 code used", MISSING_MASS: "No net mass",
  MISSING_ORIGIN: "No country of origin", MISSING_VAT: "Partner has no VAT number", VAT_NOT_VALID: "Partner VAT number not valid at VIES",
};

// ── lines and aggregation ──

export type TradeLine = {
  partnerCountry: string; partnerVat: string | null; partnerName: string | null; indicator: Indicator | null;
  cnCode: string | null; description: string | null; originCountry: string | null; netMassKg: number | null; suppQty: number | null; suppUnit: string | null;
  value: number; natureCode: string | null; transportMode: string | null; deliveryTerms: string | null; correctsPeriod: string | null;
  sourceNumber: string | null;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type EcslRow = { partnerCountry: string; partnerVat: string; partnerName: string; indicator: Indicator; value: number; correctsPeriod: string | null };
/** One row per partner VAT number and indicator (and corrected period); zero rows dropped. */
export function aggregateEcsl(lines: TradeLine[]): EcslRow[] {
  const by = new Map<string, EcslRow>();
  for (const l of lines) {
    const vat = l.partnerVat ?? "";
    const k = `${vat}|${l.indicator ?? "GOODS"}|${l.correctsPeriod ?? ""}`;
    const cur = by.get(k) ?? { partnerCountry: l.partnerCountry, partnerVat: vat, partnerName: l.partnerName ?? "", indicator: l.indicator ?? "GOODS", value: 0, correctsPeriod: l.correctsPeriod };
    cur.value = r2(cur.value + l.value);
    by.set(k, cur);
  }
  return [...by.values()].filter((r) => r.value !== 0).sort((a, b) => a.partnerVat.localeCompare(b.partnerVat) || a.indicator.localeCompare(b.indicator));
}

export type IntrastatRow = {
  cnCode: string; partnerCountry: string; originCountry: string; natureCode: string; transportMode: string; deliveryTerms: string; partnerVat: string;
  netMassKg: number; suppQty: number | null; suppUnit: string | null; value: number; description: string; correctsPeriod: string | null;
};
/** One row per CN8 code, partner country, origin, nature, transport, terms and partner VAT. */
export function aggregateIntrastat(lines: TradeLine[], d: TradeSettings["defaults"]): IntrastatRow[] {
  const by = new Map<string, IntrastatRow>();
  for (const l of lines) {
    const row: IntrastatRow = {
      cnCode: l.cnCode ?? "", partnerCountry: l.partnerCountry, originCountry: l.originCountry ?? "", natureCode: l.natureCode ?? d.natureCode, transportMode: l.transportMode ?? d.transportMode,
      deliveryTerms: l.deliveryTerms ?? d.deliveryTerms, partnerVat: l.partnerVat ?? "", netMassKg: 0, suppQty: null, suppUnit: l.suppUnit, value: 0, description: l.description ?? "", correctsPeriod: l.correctsPeriod,
    };
    const k = [row.cnCode, row.partnerCountry, row.originCountry, row.natureCode, row.transportMode, row.deliveryTerms, row.partnerVat, row.correctsPeriod ?? ""].join("|");
    const cur = by.get(k) ?? row;
    cur.netMassKg = r3(cur.netMassKg + (l.netMassKg ?? 0));
    if (l.suppQty != null) cur.suppQty = r3((cur.suppQty ?? 0) + l.suppQty);
    cur.value = r2(cur.value + l.value);
    by.set(k, cur);
  }
  return [...by.values()].filter((r) => r.value !== 0 || r.netMassKg !== 0).sort((a, b) => a.cnCode.localeCompare(b.cnCode) || a.partnerCountry.localeCompare(b.partnerCountry));
}

// ── files ──

export type FileTable = { name: string; headers: string[]; rows: (string | number | null)[][]; money?: number[] };
export type Declarant = { name: string; vat: string; taxId: string; country: string; phone?: string | null; contact?: string | null };
export type FileOut = { fileName: string; contentType: string; body: string };

const num = (x: number, dec: number, comma: boolean) => { const v = x.toFixed(dec); return comma ? v.replace(".", ",") : v; };
/** CSV with a BOM; a cell is quoted only when it holds the separator, a quote or a line break. */
export function csv(headers: string[], rows: (string | number | null)[][], sep = ";") {
  const cell = (v: string | number | null) => { const t = v == null ? "" : String(v); return t.includes(sep) || /["\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return `\uFEFF${[headers.map(cell).join(sep), ...rows.map((r) => r.map(cell).join(sep))].join("\r\n")}\r\n`;
}
const INDICATOR_CODE: Record<TradeFormat, Record<Indicator, string>> = {
  GENERIC: { GOODS: "GOODS", TRIANGULAR: "TRIANGULAR", SERVICES: "SERVICES" },
  PT: { GOODS: "1", TRIANGULAR: "4", SERVICES: "5" }, // Declaração Recapitulativa: 1 bens, 4 operações triangulares, 5 serviços
  ES: { GOODS: "E", TRIANGULAR: "T", SERVICES: "S" }, // Modelo 349 clave: E entregas, T triangulares, S servicios prestados
  FR: { GOODS: "B", TRIANGULAR: "T", SERVICES: "S" },
  DE: { GOODS: "L", TRIANGULAR: "D", SERVICES: "S" }, // ZM: L Lieferungen, D Dreiecksgeschäfte, S sonstige Leistungen
};

/** Spreadsheet view of a return (generic CSV / Excel). */
export function genericTable(kind: TradeKind, lines: TradeLine[], d: TradeSettings["defaults"]): FileTable {
  if (kind === "ECSL")
    return { name: "EC Sales List", headers: ["Country", "VAT number", "Customer", "Type", "Value EUR", "Corrects period"], rows: aggregateEcsl(lines).map((r) => [vatPrefix(r.partnerCountry), r.partnerVat, r.partnerName, r.indicator, r2(r.value), r.correctsPeriod]), money: [4] };
  return {
    name: kind === "ARRIVALS" ? "Intrastat arrivals" : "Intrastat dispatches",
    headers: ["CN8", "Description", kind === "ARRIVALS" ? "Country of consignment" : "Country of destination", "Country of origin", "Nature of transaction", "Mode of transport", "Delivery terms", "Partner VAT", "Net mass kg", "Supplementary units", "Unit", "Invoice value EUR", "Statistical value EUR", "Corrects period"],
    rows: aggregateIntrastat(lines, d).map((r) => [r.cnCode, r.description, r.partnerCountry, r.originCountry, r.natureCode, r.transportMode, r.deliveryTerms, r.partnerVat, r.netMassKg, r.suppQty, r.suppUnit, r2(r.value), r2(r.value), r.correctsPeriod]),
    money: [11, 12],
  };
}

function ptFile(kind: TradeKind, lines: TradeLine[], d: TradeSettings["defaults"], period: string): FileOut {
  if (kind === "ECSL") {
    // AT — Declaração Recapitulativa (anexo): país, NIF do adquirente, valor, tipo de operação
    const rows = aggregateEcsl(lines).map((r) => [vatPrefix(r.partnerCountry), vatNumberPart(r.partnerVat), num(r.value, 2, true), INDICATOR_CODE.PT[r.indicator], r.correctsPeriod ?? ""]);
    return { fileName: `DR_${period}.csv`, contentType: "text/csv; charset=utf-8", body: csv(["Pais", "NIF_Adquirente", "Valor", "Tipo_Operacao", "Periodo_Corrigido"], rows) };
  }
  // INE — Intrastat (Introduções / Expedições): NC8, país, natureza, modo de transporte, condições de entrega, massa, unidades, valores, NIF parceiro, origem
  const rows = aggregateIntrastat(lines, d).map((r) => [r.cnCode, r.partnerCountry, r.natureCode, r.transportMode, r.deliveryTerms, num(r.netMassKg, 0, true), r.suppQty == null ? "" : num(r.suppQty, 0, true), num(r.value, 0, true), num(r.value, 0, true), r.partnerVat, r.originCountry]);
  return { fileName: `INTRASTAT_${kind === "ARRIVALS" ? "INTRO" : "EXPED"}_${period}.csv`, contentType: "text/csv; charset=utf-8", body: csv(["NC8", kind === "ARRIVALS" ? "Pais_Proveniencia" : "Pais_Destino", "Natureza_Transacao", "Modo_Transporte", "Condicoes_Entrega", "Massa_Liquida", "Unidades_Suplementares", "Valor_Faturado", "Valor_Estatistico", "NIF_Parceiro", "Pais_Origem"], rows) };
}

const fx = (v: string, len: number) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ,.\-&]/g, " ").slice(0, len).padEnd(len, " ");
const fnum = (v: number, len: number) => String(Math.round(Math.abs(v))).padStart(len, "0").slice(-len);
/** AEAT Modelo 349: fixed-width records of 500 characters (type 1 declarant, type 2 per operator). */
function es349(lines: TradeLine[], decl: Declarant, period: string): FileOut {
  const rows = aggregateEcsl(lines).filter((r) => !r.correctsPeriod);
  const year = period.slice(0, 4);
  const p = /Q(\d)/.exec(period) ? `${/Q(\d)/.exec(period)![1]}T` : period.slice(5, 7);
  const nif = fx(vatNumberPart(decl.vat || decl.taxId), 9);
  const cents = (v: number) => Math.round(v * 100);
  const total = rows.reduce((a, r) => a + cents(r.value), 0);
  const t1 = ["1", "349", year, nif, fx(decl.name, 40), "T", fx((decl.phone ?? "").replace(/\D/g, ""), 9), fx(decl.contact ?? decl.name, 40), `349${year}${p.replace("T", "0").padStart(2, "0")}`.padEnd(13, "0").slice(0, 13), "  ", fnum(0, 13), fx(p, 2), fnum(rows.length, 9), fnum(total, 15), fnum(0, 9), fnum(0, 15), " "].join("");
  const r1 = t1.padEnd(500, " ").slice(0, 500);
  const recs = rows.map((r) => ["2", "349", year, nif, " ".repeat(58), fx(vatPrefix(r.partnerCountry), 2), fx(vatNumberPart(r.partnerVat), 15), fx(r.partnerName, 40), INDICATOR_CODE.ES[r.indicator], fnum(cents(r.value), 13)].join("").padEnd(500, " ").slice(0, 500));
  return { fileName: `349_${year}_${p}.txt`, contentType: "text/plain; charset=iso-8859-1", body: [r1, ...recs].join("\r\n") + "\r\n" };
}

const xml = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** France — DEB (Intrastat) in the customs INSTAT XML; DES / goods recap as CSV. */
function frFile(kind: TradeKind, lines: TradeLine[], d: TradeSettings["defaults"], decl: Declarant, period: string): FileOut {
  if (kind === "ECSL") {
    const rows = aggregateEcsl(lines).map((r) => [vatPrefix(r.partnerCountry), r.partnerVat, num(r.value, 0, false), INDICATOR_CODE.FR[r.indicator], r.correctsPeriod ?? ""]);
    return { fileName: `ETAT_RECAPITULATIF_${period}.csv`, contentType: "text/csv; charset=utf-8", body: csv(["Code pays", "Numero TVA", "Montant", "Type", "Periode corrigee"], rows) };
  }
  const items = aggregateIntrastat(lines, d).map((r, i) => `      <Item>
        <itemNumber>${i + 1}</itemNumber>
        <CN8><CN8Code>${xml(r.cnCode)}</CN8Code></CN8>
        <MSConsDestCode>${xml(r.partnerCountry)}</MSConsDestCode>
        <countryOfOriginCode>${xml(r.originCountry)}</countryOfOriginCode>
        <netMass>${Math.max(1, Math.round(r.netMassKg))}</netMass>
        ${r.suppQty != null ? `<quantityInSU>${Math.round(r.suppQty)}</quantityInSU>` : ""}
        <invoicedAmount>${Math.round(r.value)}</invoicedAmount>
        ${kind === "DISPATCHES" ? `<partnerId>${xml(r.partnerVat)}</partnerId>` : ""}
        <statisticalProcedureCode>${kind === "ARRIVALS" ? "11" : "21"}</statisticalProcedureCode>
        <NatureOfTransaction><natureOfTransactionACode>${xml(r.natureCode.slice(0, 1))}</natureOfTransactionACode><natureOfTransactionBCode>${xml(r.natureCode.slice(1, 2) || "1")}</natureOfTransactionBCode></NatureOfTransaction>
        <modeOfTransportCode>${xml(r.transportMode)}</modeOfTransportCode>
      </Item>`).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<INSTAT>
  <Envelope>
    <envelopeId>FIR${period.replace(/\D/g, "")}${kind === "ARRIVALS" ? "A" : "D"}</envelopeId>
    <DateTime><date>${new Date().toISOString().slice(0, 10)}</date><time>${new Date().toISOString().slice(11, 19)}</time></DateTime>
    <Party partyType="PSI" partyRole="sender"><partyId>${xml(decl.vat)}</partyId><partyName>${xml(decl.name)}</partyName></Party>
    <softwareUsed>FIRINGI</softwareUsed>
    <Declaration>
      <declarationId>${period.replace(/\D/g, "")}</declarationId>
      <referencePeriod>${xml(period)}</referencePeriod>
      <PSIId>${xml(decl.vat)}</PSIId>
      <Function><functionCode>O</functionCode></Function>
      <declarationTypeCode>1</declarationTypeCode>
      <flowCode>${kind === "ARRIVALS" ? "A" : "D"}</flowCode>
      <currencyCode>EUR</currencyCode>
${items}
    </Declaration>
  </Envelope>
</INSTAT>
`;
  return { fileName: `DEB_${kind === "ARRIVALS" ? "INTRO" : "EXPED"}_${period}.xml`, contentType: "application/xml; charset=utf-8", body };
}

/** Germany — Zusammenfassende Meldung (BZSt CSV) and Intrastat for IDEV (CSV). */
function deFile(kind: TradeKind, lines: TradeLine[], d: TradeSettings["defaults"], period: string): FileOut {
  if (kind === "ECSL") {
    const rows = aggregateEcsl(lines).map((r) => [vatPrefix(r.partnerCountry), vatNumberPart(r.partnerVat), num(r.value, 0, false), INDICATOR_CODE.DE[r.indicator]]);
    return { fileName: `ZM_${period}.csv`, contentType: "text/csv; charset=utf-8", body: csv(["Laenderkennzeichen", "USt-IdNr.", "Betrag (EUR)", "Art der Leistung"], rows, ",") };
  }
  const rows = aggregateIntrastat(lines, d).map((r) => [r.cnCode, r.partnerCountry, r.originCountry, r.natureCode, r.transportMode, num(r.netMassKg, 0, true), r.suppQty == null ? "" : num(r.suppQty, 0, true), num(r.value, 0, true), num(r.value, 0, true), r.partnerVat]);
  return { fileName: `IDEV_${kind === "ARRIVALS" ? "EINGANG" : "VERSENDUNG"}_${period}.csv`, contentType: "text/csv; charset=utf-8", body: csv(["Warennummer", kind === "ARRIVALS" ? "Versendungsland" : "Bestimmungsland", "Ursprungsland", "Art des Geschaefts", "Verkehrszweig", "Eigenmasse", "Besondere Masseinheit", "Rechnungsbetrag", "Statistischer Wert", "USt-IdNr Partner"], rows) };
}

/** The national file for a return (Spain's Intrastat uses the generic layout for the AEAT upload). */
export function nationalFile(format: TradeFormat, kind: TradeKind, lines: TradeLine[], d: TradeSettings["defaults"], decl: Declarant, period: string): FileOut {
  if (format === "PT") return ptFile(kind, lines, d, period);
  if (format === "ES" && kind === "ECSL") return es349(lines, decl, period);
  if (format === "FR") return frFile(kind, lines, d, decl, period);
  if (format === "DE") return deFile(kind, lines, d, period);
  const t = genericTable(kind, lines, d);
  return { fileName: `${kind}_${period}.csv`, contentType: "text/csv; charset=utf-8", body: csv(t.headers, t.rows) };
}
