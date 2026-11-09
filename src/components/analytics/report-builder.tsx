/** Custom report builder (back office): up to two dimensions, any figures, table + chart + export. */
import { Download } from "lucide-react";
import { AppError } from "@/server/errors";
import { DIMENSIONS, LINE_METRICS, METRICS, report, type Dim, type Filters, type Metric, type Row } from "@/server/analytics/engine";
import { DIM_LABEL, METRIC_FMT, METRIC_LABEL, labelRows } from "@/server/analytics/labels";
import { fillSeries, qs, type SearchParams } from "@/server/analytics/params";
import { BarList, ChartCard, TimeChart } from "./charts";
import { fmtValue } from "@/lib/analytics-format";

const TIME = new Set<Dim>(["day", "week", "month"]);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(",") : []);

export async function ReportBuilder({ searchParams, filters, locale, params }: { searchParams: SearchParams; filters: Filters; locale: string; params: Record<string, string> }) {
  const d1 = one(searchParams.d1) as Dim;
  const d2 = one(searchParams.d2) as Dim;
  const dims = [d1, d2].filter((d, i, a) => d && DIMENSIONS.includes(d) && a.indexOf(d) === i) as Dim[];
  const metrics = many(searchParams.m).filter((m): m is Metric => METRICS.includes(m as Metric));
  const run = dims.length > 0 && metrics.length > 0;
  let rows: Row[] = [];
  let error: string | null = null;
  const lineMode = dims.some((d) => d === "product" || d === "category" || d === "categoryRoot") || metrics.includes("units");
  const notPerLine = lineMode ? metrics.filter((m) => !LINE_METRICS.includes(m)) : [];
  if (run && notPerLine.length) error = `${notPerLine.map((m) => METRIC_LABEL[m]).join(", ")} can't be split by product or category.`;
  else if (run) {
    try { rows = await report(filters, dims, metrics, { limit: 500 }); }
    catch (e) { if (e instanceof AppError) error = e.message; else throw e; }
  }
  const label = run && !error ? await labelRows(rows, dims, locale) : null;
  const sel = "h-9 rounded-md border bg-card px-2 text-sm";
  const exportHref = (format: string) => `/api/analytics/export${qs(params, { audience: "ADMIN", dims: dims.join(","), metrics: metrics.join(","), format })}`;

  return (
    <div className="grid gap-4">
      <form method="get" className="rounded-xl border bg-card p-4" data-testid="report-builder">
        {Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="flex flex-wrap gap-4">
          <label className="grid gap-1 text-xs text-muted-foreground">Rows
            <select name="d1" defaultValue={d1} className={sel}>
              <option value="">Choose…</option>
              {DIMENSIONS.map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Then by (optional)
            <select name="d2" defaultValue={d2} className={sel}>
              <option value="">—</option>
              {DIMENSIONS.map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="mt-4">
          <legend className="mb-2 text-xs text-muted-foreground">Figures</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {METRICS.map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="m" value={m} defaultChecked={metrics.includes(m)} className="h-4 w-4" />{METRIC_LABEL[m]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Product and category rows use order lines: gross, VAT, fees, discounts and revenue are only available per order.</p>
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Run report</button>
          {run && !error && (
            <>
              <a className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted" href={exportHref("csv")} data-testid="export-csv"><Download className="h-4 w-4" />CSV</a>
              <a className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted" href={exportHref("xlsx")} data-testid="export-xlsx"><Download className="h-4 w-4" />Excel</a>
            </>
          )}
        </div>
      </form>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}

      {run && !error && label && dims.length === 1 && rows.length > 0 && (
        TIME.has(dims[0]) ? (() => {
          const g = dims[0] as "day" | "week" | "month";
          const { points, values } = fillSeries(rows, g, filters.from, filters.to, metrics);
          const fmt = METRIC_FMT[metrics[0]];
          const same = metrics.filter((m) => METRIC_FMT[m] === fmt).slice(0, 3); // one axis, one unit
          return (
            <ChartCard title={same.map((m) => METRIC_LABEL[m]).join(" · ")}>
              <TimeChart points={points} grain={g} series={same.map((m) => ({ key: m, label: METRIC_LABEL[m], values: values[m] }))} fmt={fmt} locale={locale} />
            </ChartCard>
          );
        })() : (
          <ChartCard title={`${METRIC_LABEL[metrics[0]]} by ${DIM_LABEL[dims[0]].toLowerCase()}`}>
            <BarList rows={rows.slice(0, 15).map((r) => ({ key: r.keys[dims[0]] ?? "-", label: label(dims[0], r.keys[dims[0]]), value: r.values[metrics[0]] }))} fmt={METRIC_FMT[metrics[0]]} locale={locale} />
          </ChartCard>
        )
      )}

      {run && !error && label && (
        <section className="rounded-xl border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">{rows.length} row{rows.length === 1 ? "" : "s"}{rows.length === 500 ? " (first 500 — export for all)" : ""}</h2>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-sm" data-testid="report-table">
              <thead className="sticky top-0 bg-card"><tr className="border-b">
                {dims.map((d) => <th key={d} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{DIM_LABEL[d]}</th>)}
                {metrics.map((m) => <th key={m} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">{METRIC_LABEL[m]}</th>)}
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={dims.length + metrics.length} className="px-3 py-8 text-center text-muted-foreground">No data in this period.</td></tr>}
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {dims.map((d) => <td key={d} className="px-3 py-1.5">{label(d, r.keys[d])}</td>)}
                    {metrics.map((m) => <td key={m} className="px-3 py-1.5 text-right tabular-nums">{fmtValue(r.values[m], METRIC_FMT[m], locale)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
