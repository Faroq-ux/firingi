/** Number and period formatting shared by charts, tables and exports (no React). */
/** "money" = EUR; Phase 45: "money:PLN" = amounts already in that currency. */
export type Fmt = "money" | "number" | "percent" | `money:${string}`;

export function fmtValue(v: number, fmt: Fmt, locale: string, compact = false) {
  if (!Number.isFinite(v)) return "—";
  if (fmt === "percent") return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(v);
  if (fmt === "money" || fmt.startsWith("money:")) {
    const currency = fmt === "money" ? "EUR" : fmt.slice(6);
    const dp = currency === "ISK" ? 0 : 2;
    return new Intl.NumberFormat(locale, { style: "currency", currency, ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: dp, maximumFractionDigits: dp }) }).format(v);
  }
  return new Intl.NumberFormat(locale, compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }).format(v);
}

export function fmtPeriod(iso: string, grain: "day" | "week" | "month", locale: string) {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso.replace(" ", "T").replace(/\+00$/, "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, grain === "month" ? { month: "short", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
