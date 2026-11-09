/** Number and period formatting shared by charts, tables and exports (no React). */
export type Fmt = "money" | "number" | "percent";

export function fmtValue(v: number, fmt: Fmt, locale: string, compact = false) {
  if (!Number.isFinite(v)) return "—";
  if (fmt === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(v);
  if (fmt === "money")
    return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }).format(v);
  return new Intl.NumberFormat(locale, compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }).format(v);
}

export function fmtPeriod(iso: string, grain: "day" | "week" | "month", locale: string) {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso.replace(" ", "T").replace(/\+00$/, "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, grain === "month" ? { month: "short", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
