/** Vendor sales report and buyer spending report (translated; scoped to the caller's company). */
import { Download } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { kpis, previousPeriod, report, type Dim, type Filters, type Metric } from "@/server/analytics/engine";
import { fillSeries, qs, readQuery, type SearchParams } from "@/server/analytics/params";
import { PageHeader } from "@/components/layout/page-header";
import { BarList, ChartCard, TimeChart } from "./charts";
import { fmtPeriod, fmtValue, type Fmt } from "@/lib/analytics-format";
import { FilterBar, type FilterLabels } from "./filter-bar";
import { Kpi, barRows } from "./kit";

type T = Awaited<ReturnType<typeof getTranslations<"reports">>>;
const PRESETS = ["7d", "30d", "90d", "mtd", "lastmonth", "ytd", "12m", "custom"] as const;

function filterLabels(t: T): FilterLabels {
  return {
    period: t("period"), presets: Object.fromEntries(PRESETS.map((p) => [p, t(`presets.${p}`)])),
    from: t("from"), to: t("to"), basis: t("basis"), placed: t("placed"), delivered: t("delivered"), all: t("all"),
  };
}

function Exports({ t, audience, params, dims, metrics }: { t: T; audience: "VENDOR" | "BUYER"; params: Record<string, string>; dims: Dim[]; metrics: Metric[] }) {
  const href = (format: string) => `/api/analytics/export${qs(params, { audience, dims: dims.join(","), metrics: metrics.join(","), format })}`;
  const cls = "inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-sm hover:bg-muted";
  return (
    <>
      <a className={cls} href={href("csv")} data-testid="export-csv"><Download className="h-4 w-4" />{t("exportCsv")}</a>
      <a className={cls} href={href("xlsx")} data-testid="export-xlsx"><Download className="h-4 w-4" />{t("exportExcel")}</a>
    </>
  );
}

async function Trend({ t, f, grain, locale, title, metric, fmt, kind }: { t: T; f: Filters; grain: "day" | "week" | "month"; locale: string; title: string; metric: Metric; fmt: Fmt; kind: "line" | "bar" }) {
  const p = previousPeriod(f);
  const [rows, prevRows] = await Promise.all([report(f, [grain], [metric]), report(p, [grain], [metric])]);
  const { points, values } = fillSeries(rows, grain, f.from, f.to, [metric]);
  const prev = fillSeries(prevRows, grain, p.from, p.to, [metric]).values[metric];
  const series = [
    { key: "now", label: t("thisPeriod"), values: values[metric] },
    { key: "prev", label: t("previousPeriod"), values: points.map((_, i) => prev[prev.length - points.length + i] ?? 0) },
  ];
  return (
    <ChartCard title={title} labels={{ chart: t("chart"), table: t("table") }}
      table={{ head: [t("period"), series[0].label, series[1].label], align: ["left", "right", "right"], rows: points.map((pt, i) => [fmtPeriod(pt, grain, locale), fmtValue(series[0].values[i], fmt, locale), fmtValue(series[1].values[i], fmt, locale)]) }}>
      <TimeChart points={points} grain={grain} series={series} fmt={fmt} locale={locale} kind={kind} testId="chart-trend" />
    </ChartCard>
  );
}

async function Rank({ t, f, dim, metric, fmt, locale, title, enumLabels }: { t: T; f: Filters; dim: Dim; metric: Metric; fmt: Fmt; locale: string; title: string; enumLabels?: Record<string, string> }) {
  const rows = await barRows(await report(f, [dim], [metric], { limit: 10 }), dim, metric, locale, { enumLabels });
  return (
    <ChartCard title={title} labels={{ chart: t("chart"), table: t("table") }}
      table={{ head: [t("name"), t("value")], align: ["left", "right"], rows: rows.map((r) => [r.label, fmtValue(r.value, fmt, locale)]) }}>
      <BarList rows={rows} fmt={fmt} locale={locale} emptyText={t("noData")} testId={`bars-${dim}`} />
    </ChartCard>
  );
}

const modeLabels = (t: T) => Object.fromEntries(["VENDOR_FLEET", "FIRINGI_FLEET", "CARRIER", "-"].map((k) => [k, t(`deliveryMode.${k}`)]));

export async function VendorSalesReport({ ctx, searchParams }: { ctx: Ctx; searchParams: SearchParams }) {
  const [t, locale] = await Promise.all([getTranslations("reports"), getLocale()]);
  const q = await readQuery(ctx, "VENDOR", searchParams);
  const f = q.filters;
  const [goods, prevGoods, k, p] = await Promise.all([
    report(f, [], ["goodsNet", "orders"]), report(previousPeriod(f), [], ["goodsNet", "orders"]), kpis(f), kpis(previousPeriod(f)),
  ]);
  const g = goods[0]?.values ?? { goodsNet: 0, orders: 0 };
  const pg = prevGoods[0]?.values ?? { goodsNet: 0, orders: 0 };
  const avg = (v: Record<string, number>) => (v.orders ? v.goodsNet / v.orders : 0);
  const vs = t("vsPrevious");
  return (
    <>
      <PageHeader title={t("vendorTitle")} description={t("vendorDescription")}
        actions={<Exports t={t} audience="VENDOR" params={q.params} dims={[q.grain]} metrics={["orders", "buyers", "goodsNet", "commission", "payout"]} />} />
      <FilterBar labels={filterLabels(t)} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("sales")} value={g.goodsNet} prev={pg.goodsNet} fmt={q.money} locale={locale} vsLabel={vs} testId="kpi-sales" />
        <Kpi label={t("orders")} value={k.orders} prev={p.orders} fmt="number" locale={locale} vsLabel={vs} testId="kpi-orders" />
        <Kpi label={t("avgOrder")} value={avg(g)} prev={avg(pg)} fmt={q.money} locale={locale} vsLabel={vs} />
        <Kpi label={t("payout")} value={k.payout} prev={p.payout} fmt={q.money} locale={locale} vsLabel={vs} hint={`${t("commission")}: ${fmtValue(k.commission, q.money, locale)}`} />
      </div>
      <div className="grid gap-4">
        <Trend t={t} f={f} grain={q.grain} locale={locale} title={t("salesOverTime")} metric="goodsNet" fmt={q.money} kind="line" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Rank t={t} f={f} dim="product" metric="net" fmt={q.money} locale={locale} title={t("topProducts")} />
          <Rank t={t} f={f} dim="buyer" metric="goodsNet" fmt={q.money} locale={locale} title={t("topCustomers")} />
          <Rank t={t} f={f} dim="categoryRoot" metric="net" fmt={q.money} locale={locale} title={t("byCategory")} />
          <Rank t={t} f={f} dim="region" metric="goodsNet" fmt={q.money} locale={locale} title={t("byRegion")} />
        </div>
      </div>
    </>
  );
}

export async function BuyerSpendingReport({ ctx, searchParams }: { ctx: Ctx; searchParams: SearchParams }) {
  const [t, locale] = await Promise.all([getTranslations("reports"), getLocale()]);
  const q = await readQuery(ctx, "BUYER", searchParams);
  const f = q.filters;
  const [k, p, d, pd] = await Promise.all([kpis(f), kpis(previousPeriod(f)), report(f, [], ["discount"]), report(previousPeriod(f), [], ["discount"])]);
  const vs = t("vsPrevious");
  return (
    <>
      <PageHeader title={t("buyerTitle")} description={t("buyerDescription")}
        actions={<Exports t={t} audience="BUYER" params={q.params} dims={[q.grain]} metrics={["orders", "net", "vat", "gross", "discount"]} />} />
      <FilterBar labels={filterLabels(t)} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("spend")} value={k.gross} prev={p.gross} fmt={q.money} locale={locale} vsLabel={vs} hint={t("spendHint")} testId="kpi-spend" />
        <Kpi label={t("spendNet")} value={k.net} prev={p.net} fmt={q.money} locale={locale} vsLabel={vs} />
        <Kpi label={t("orders")} value={k.orders} prev={p.orders} fmt="number" locale={locale} vsLabel={vs} testId="kpi-orders" />
        <Kpi label={t("saved")} value={d[0]?.values.discount ?? 0} prev={pd[0]?.values.discount ?? 0} fmt={q.money} locale={locale} vsLabel={vs} />
      </div>
      <div className="grid gap-4">
        <Trend t={t} f={f} grain={q.grain} locale={locale} title={t("spendOverTime")} metric="gross" fmt={q.money} kind="bar" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Rank t={t} f={f} dim="vendor" metric="gross" fmt={q.money} locale={locale} title={t("bySupplier")} />
          <Rank t={t} f={f} dim="product" metric="net" fmt={q.money} locale={locale} title={t("topProducts")} />
          <Rank t={t} f={f} dim="categoryRoot" metric="net" fmt={q.money} locale={locale} title={t("byCategory")} />
          <Rank t={t} f={f} dim="deliveryMode" metric="orders" fmt="number" locale={locale} title={t("byDeliveryMode")} enumLabels={modeLabels(t)} />
        </div>
      </div>
    </>
  );
}
