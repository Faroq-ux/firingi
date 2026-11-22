/** Sales reps (Phase 62) — pure rules shared by the server and the pages. Docs: docs/sales-reps.md. */

export type SalesRepSettings = {
  enabled: boolean;
  /** customers may let a supplier's reps place their orders without confirming each one */
  allowAutoConfirm: boolean;
  /** how long a customer has to confirm an order a rep took */
  confirmHours: number;
  /** photos per visit */
  maxPhotos: number;
};
export const DEFAULT_SALES_REP_SETTINGS: SalesRepSettings = { enabled: true, allowAutoConfirm: true, confirmHours: 48, maxPhotos: 4 };

export function mergeSalesRepSettings(v: Partial<SalesRepSettings> | null | undefined): SalesRepSettings {
  const d = DEFAULT_SALES_REP_SETTINGS;
  if (!v || typeof v !== "object") return { ...d };
  const int = (x: unknown, lo: number, hi: number, def: number) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  return { enabled: v.enabled ?? d.enabled, allowAutoConfirm: v.allowAutoConfirm ?? d.allowAutoConfirm, confirmHours: int(v.confirmHours, 1, 168, d.confirmHours), maxPhotos: int(v.maxPhotos, 0, 10, d.maxPhotos) };
}

/** First day of a month (UTC) from "YYYY-MM" or a date, and the first day of the next month. */
export function monthRange(month?: string | null, now = new Date()) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [y, mo] = m.split("-").map(Number);
  return { key: m, from: new Date(Date.UTC(y, mo - 1, 1)), to: new Date(Date.UTC(y, mo, 1)) };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Commission on the net goods delivered, and how far the target is reached (null = no target). */
export function commission(netDelivered: number, pct: number, target: number | null) {
  return { commission: r2((netDelivered * pct) / 100), targetPct: target && target > 0 ? Math.round((netDelivered / target) * 1000) / 10 : null };
}

/** Days since a date (null stays null). */
export const daysSince = (d: Date | string | null | undefined, now = new Date()) => (d ? Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 86400_000)) : null);
