/**
 * Cold chain & HACCP (Phase 42) — settings and the pure rules (tested in tests/unit/cold-chain.test.ts).
 * Every recording method, every reaction to an out-of-range reading and every record type is switched by FIRINGI.
 */
export type ColdChainSettings = {
  enabled: boolean;
  /** Who records temperatures. */
  record: { supplierDispatch: boolean; driverLoading: boolean; driverHandover: boolean; customerReceipt: boolean; loggers: boolean };
  /** The driver must record a temperature per cold class before the handover. */
  requireHandover: boolean;
  /** What happens when a reading is out of range. */
  actions: { customerRefuse: boolean; alert: boolean; block: boolean; score: boolean };
  /** Records available to customers and suppliers. */
  records: { certificate: boolean; monthly: boolean; equipment: boolean; receivingLog: boolean };
  /** A logger out of range this many minutes in a row raises an alert. */
  loggerAlertMinutes: number;
};

export const DEFAULT_COLD_CHAIN_SETTINGS: ColdChainSettings = {
  enabled: true,
  record: { supplierDispatch: true, driverLoading: true, driverHandover: true, customerReceipt: true, loggers: true },
  requireHandover: false,
  actions: { customerRefuse: true, alert: true, block: false, score: true },
  records: { certificate: true, monthly: true, equipment: true, receivingLog: true },
  loggerAlertMinutes: 15,
};

export function mergeColdChainSettings(v: Partial<ColdChainSettings> | null | undefined): ColdChainSettings {
  const d = DEFAULT_COLD_CHAIN_SETTINGS;
  const x = v ?? {};
  return { ...d, ...x, record: { ...d.record, ...(x.record ?? {}) }, actions: { ...d.actions, ...(x.actions ?? {}) }, records: { ...d.records, ...(x.records ?? {}) } };
}

export type TempRange = { minC: number | null; maxC: number | null; toleranceC: number };
export type TempStatusValue = "OK" | "WARN" | "OUT";

/** OK inside the range, WARN within the tolerance, OUT beyond it. */
export function classify(valueC: number, r: TempRange): TempStatusValue {
  const below = r.minC != null ? r.minC - valueC : 0;
  const above = r.maxC != null ? valueC - r.maxC : 0;
  const off = Math.max(below, above, 0);
  if (off <= 1e-9) return "OK";
  return off <= r.toleranceC + 1e-9 ? "WARN" : "OUT";
}

const fmt = (n: number) => (n < 0 ? `−${Math.abs(n)}` : String(n)).replace(".", ",");

/** "0–4 °C", "≤ −18 °C", "≥ 2 °C", "" (no limits). */
export function rangeLabel(r: Pick<TempRange, "minC" | "maxC">) {
  if (r.minC != null && r.maxC != null) return `${fmt(r.minC)}–${fmt(r.maxC)} °C`;
  if (r.maxC != null) return `≤ ${fmt(r.maxC)} °C`;
  if (r.minC != null) return `≥ ${fmt(r.minC)} °C`;
  return "";
}

/** "−18,5", "-18.5 °C", "3" → number (null when not a temperature between −60 and 80 °C). */
export function parseC(text: string | number | null | undefined): number | null {
  if (text == null) return null;
  if (typeof text === "number") return Number.isFinite(text) && text >= -60 && text <= 80 ? Math.round(text * 10) / 10 : null;
  const m = /^\s*([−\-+]?)\s*(\d+(?:[.,]\d+)?)\s*(?:°?\s*C)?\s*$/i.exec(text);
  if (!m) return null;
  const v = Number(m[2].replace(",", ".")) * (m[1] === "−" || m[1] === "-" ? -1 : 1);
  return v >= -60 && v <= 80 ? Math.round(v * 10) / 10 : null;
}

/** The class of an offer: the supplier's choice, else the nearest category (child first) that has one. */
export const effectiveClass = (offerClassId: string | null | undefined, categoryChain: (string | null | undefined)[]) =>
  offerClassId ?? categoryChain.find((c) => !!c) ?? null;

/**
 * Whose fault an out-of-range handover is (refused / blocked goods):
 *   dispatch or loading out of range → SUPPLIER (warm before it left); in range at loading (or at dispatch) → the carrier
 *   (DRIVER on FIRINGI's fleet, else the SUPPLIER's own fleet); nothing recorded → FIRINGI on its fleet (it didn't check), else SUPPLIER.
 */
export function inferFault(i: { dispatch?: TempStatusValue | null; loading?: TempStatusValue | null; firingiFleet: boolean }): "SUPPLIER" | "DRIVER" | "FIRINGI" {
  if (i.dispatch === "OUT") return "SUPPLIER";
  if (i.loading === "OUT") return "SUPPLIER"; // already warm when the driver loaded
  if (i.loading === "OK" || i.loading === "WARN") return i.firingiFleet ? "DRIVER" : "SUPPLIER";
  if (i.dispatch === "OK" || i.dispatch === "WARN") return i.firingiFleet ? "DRIVER" : "SUPPLIER";
  return i.firingiFleet ? "FIRINGI" : "SUPPLIER";
}

/** Trip summary from logger readings (sorted or not): min / max / average, minutes out of range, longest stretch out. */
export function tripStats(rows: { at: Date; valueC: number }[], r: TempRange | null) {
  if (!rows.length) return null;
  const s = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const vals = s.map((x) => x.valueC);
  let outMin = 0, run = 0, longest = 0;
  for (let i = 0; i < s.length; i++) {
    const out = r ? classify(s[i].valueC, r) === "OUT" : false;
    const step = i + 1 < s.length ? (s[i + 1].at.getTime() - s[i].at.getTime()) / 60_000 : 0;
    if (out) { outMin += step; run += step; longest = Math.max(longest, run); } else run = 0;
  }
  return {
    from: s[0].at, to: s[s.length - 1].at, count: s.length,
    minC: Math.min(...vals), maxC: Math.max(...vals), avgC: Math.round((vals.reduce((a, x) => a + x, 0) / vals.length) * 10) / 10,
    minutesOut: Math.round(outMin), longestOut: Math.round(longest),
  };
}

/** Minutes the newest readings have been out of range without a break (for logger alerts). */
export function minutesOutNow(rows: { at: Date; valueC: number }[], r: TempRange) {
  const s = [...rows].sort((a, b) => b.at.getTime() - a.at.getTime());
  if (!s.length || classify(s[0].valueC, r) !== "OUT") return 0;
  let oldest = s[0].at;
  for (const x of s) { if (classify(x.valueC, r) !== "OUT") break; oldest = x.at; }
  return Math.round((s[0].at.getTime() - oldest.getTime()) / 60_000);
}

/** Next due date of an equipment task (null = no interval); overdue when before `now`. */
export function nextDue(lastDone: Date | null | undefined, everyDays: number | null | undefined, created: Date) {
  if (!everyDays) return null;
  return new Date((lastDone ?? created).getTime() + everyDays * 86_400_000);
}

/** "2026-11" → [first day, first day of next month) in UTC. */
export function monthRange(ym: string): [Date, Date] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return [new Date(Date.UTC(y, mo - 1, 1)), new Date(Date.UTC(y, mo, 1))];
}
