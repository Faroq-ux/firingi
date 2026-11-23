/** Small text helpers for the Services pages (Phase 68) — server and client. */
export type L = Record<string, string>;
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
export const money = (locale: string, n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const num = (locale: string, n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
export const day = (locale: string, d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d)) : "—");
export const isoDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
export function schedText(l: L, p: { frequency: string; weekday: number; dayA: number; dayB: number; timeWindow?: string }) {
  const s = fill(l[`sched.${p.frequency}`], { day: l[`weekdays.d${p.weekday}`] ?? "", a: p.dayA, b: p.dayB });
  return p.timeWindow && p.timeWindow !== "ANY" && p.frequency !== "ON_REQUEST" ? `${s} · ${l[`window.${p.timeWindow}`] ?? p.timeWindow}` : s;
}
export const unitText = (l: L, u: string) => l[`unit.${u}`] ?? u;
export const statusTone = (s: string): "success" | "warning" | "destructive" | "secondary" | "default" =>
  s === "DONE" || s === "ACTIVE" || s === "APPROVED" || s === "CONFIRMED" ? "success" : s === "MISSED" || s === "REJECTED" || s === "SUSPENDED" ? "destructive" : s === "REQUESTED" || s === "PENDING" || s === "PAUSED" ? "warning" : s === "SCHEDULED" ? "default" : "secondary";
