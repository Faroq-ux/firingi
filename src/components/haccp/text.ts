/** Small text helpers for the food safety pages (Phase 69). */
export type L = Record<string, string>;
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
export const when = (locale: string, d: Date | string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(d));
export const dayText = (locale: string, d: Date | string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d));
export const temp = (locale: string, v: number | null | undefined) => (v == null ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)} °C`);
export const stateTone = (s: string): "success" | "warning" | "destructive" | "secondary" | "default" => (s === "DONE" || s === "OK" ? "success" : s === "OUT" || s === "LATE" || s === "EXPIRED" ? "destructive" : s === "DUE" || s === "SOON" ? "warning" : "secondary");
