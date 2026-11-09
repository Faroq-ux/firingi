/** Server-side building blocks shared by the admin, vendor and buyer report pages. */
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { pickLocalized } from "@/i18n/config";
import { labelsFor, type Dim, type Row } from "@/server/analytics/engine";
import { fmtValue, type Fmt } from "@/lib/analytics-format";

/** Stat tile: headline number + change against the previous period (arrow + text, not colour alone). */
export function Kpi({ label, value, prev, fmt, locale, hint, testId, vsLabel = "vs previous period" }: {
  label: string; value: number; prev?: number; fmt: Fmt; locale: string; hint?: string; testId?: string; vsLabel?: string;
}) {
  const delta = prev === undefined ? null : prev === 0 ? (value === 0 ? 0 : null) : (value - prev) / Math.abs(prev);
  const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={testId}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtValue(value, fmt, locale)}</div>
      {prev !== undefined && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" title={`${vsLabel}: ${fmtValue(prev, fmt, locale)}`}>
          {delta !== null && <Icon className={`h-3.5 w-3.5 ${delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : ""}`} aria-hidden />}
          <span className="tabular-nums">{delta === null ? "—" : `${delta > 0 ? "+" : ""}${fmtValue(delta, "percent", locale)}`}</span>
          <span>{vsLabel}</span>
        </div>
      )}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Rows of a one-dimension report → BarList rows with readable labels. */
export async function barRows(rows: Row[], dim: Dim, metric: string, locale: string, opts: { enumLabels?: Record<string, string>; href?: (key: string) => string | undefined } = {}) {
  const names = await labelsFor(dim, rows.map((r) => r.keys[dim]), (v) => pickLocalized(v, locale));
  return rows.map((r) => {
    const key = r.keys[dim] ?? "-";
    return { key, label: opts.enumLabels?.[key] ?? names.get(key) ?? (key === "-" ? "—" : key), value: r.values[metric] ?? 0, href: opts.href?.(key) };
  });
}

export { ADMIN_ENUMS } from "@/server/analytics/labels";

export const ADMIN_FILTER_LABELS = {
  period: "Period",
  presets: { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", mtd: "This month", lastmonth: "Last month", ytd: "This year", "12m": "Last 12 months", custom: "Custom…" },
  from: "From", to: "To", basis: "Count orders by", placed: "Date placed", delivered: "Date delivered", all: "All",
  country: "Country", type: "Seller type", types: { WHOLESALER: "Wholesalers", DISTRIBUTOR: "Distributors" },
};
