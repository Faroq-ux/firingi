/** Back-office analytics pages (English, like the rest of the back office). */
import Link from "next/link";
import { Download } from "lucide-react";
import { getLocale } from "next-intl/server";
import type { Ctx } from "@/server/context";
import {
  buyerMix, countryOptions, creditNotesByMonth, deliveryStats, kpis, previousPeriod, report, statusFunnel,
  type Dim, type Filters, type Metric,
} from "@/server/analytics/engine";
import { fillSeries, qs, readQuery, type SearchParams } from "@/server/analytics/params";
import { PageHeader } from "@/components/layout/page-header";
import { BarList, ChartCard, TimeChart } from "./charts";
import { fmtPeriod, fmtValue, type Fmt } from "@/lib/analytics-format";
import { FilterBar } from "./filter-bar";
import { ADMIN_ENUMS, ADMIN_FILTER_LABELS, Kpi, barRows } from "./kit";
import { ReportBuilder } from "./report-builder";

export type AdminReport =
  | "sales" | "revenue" | "gross-margin" | "orders" | "customers" | "vendors" | "distributors" | "wholesalers" | "products" | "delivery" | "country" | "custom";

const TITLES: Record<AdminReport, [string, string]> = {
  sales: ["Sales Analytics", "Goods and delivery sold through FIRINGI (net of VAT)."],
  revenue: ["Revenue", "FIRINGI's own revenue: goods margin (commission less FIRINGI-funded discounts) plus delivery fees."],
  "gross-margin": ["Gross Margin", "Goods margin: what buyers paid for goods minus what FIRINGI owes vendors."],
  orders: ["Order Analytics", "Order volume, value and where orders are in their life cycle."],
  customers: ["Customer Analytics", "Who buys, how often, and who is new."],
  vendors: ["Vendor Analytics", "Sales, commission and margin per selling company."],
  distributors: ["Distributor Analytics", "Distributors selling to wholesalers."],
  wholesalers: ["Wholesaler Analytics", "Wholesalers selling to customers."],
  products: ["Product Analytics", "Best sellers by value and units, and category mix."],
  delivery: ["Delivery Analytics", "Delivery outcomes, punctuality and failure reasons."],
  country: ["Country Performance", "Sales and FIRINGI revenue per market."],
  custom: ["Custom Reports", "Pick dimensions and figures, then view or export the result."],
};

function exportLink(params: Record<string, string>, dims: Dim[], metrics: Metric[], format: "csv" | "xlsx") {
  return `/api/analytics/export${qs(params, { audience: "ADMIN", dims: dims.join(","), metrics: metrics.join(","), format })}`;
}
function ExportButtons({ params, dims, metrics }: { params: Record<string, string>; dims: Dim[]; metrics: Metric[] }) {
  const cls = "inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-sm hover:bg-muted";
  return (
    <>
      <a className={cls} href={exportLink(params, dims, metrics, "csv")} data-testid="export-csv"><Download className="h-4 w-4" />CSV</a>
      <a className={cls} href={exportLink(params, dims, metrics, "xlsx")} data-testid="export-xlsx"><Download className="h-4 w-4" />Excel</a>
    </>
  );
}

async function TimeCard({ f, grain, locale, title, description, metrics, fmt, kind = "line", compare }: {
  f: Filters; grain: "day" | "week" | "month"; locale: string; title: string; description?: string; metrics: { m: Metric; label: string }[]; fmt: Fmt; kind?: "line" | "bar"; compare?: boolean;
}) {
  const rows = await report(f, [grain], metrics.map((x) => x.m));
  const { points, values } = fillSeries(rows, grain, f.from, f.to, metrics.map((x) => x.m));
  const series: { key: string; label: string; values: number[] }[] = metrics.map((x) => ({ key: x.m, label: x.label, values: values[x.m] }));
  if (compare && metrics.length === 1) {
    // previous period aligned point by point (same grain, same length)
    const p = previousPeriod(f);
    const prevRows = await report(p, [grain], [metrics[0].m]);
    const prev = fillSeries(prevRows, grain, p.from, p.to, [metrics[0].m]).values[metrics[0].m];
    series.push({ key: "prev", label: "Previous period", values: points.map((_, i) => prev[prev.length - points.length + i] ?? 0) });
  }
  return (
    <ChartCard title={title} description={description}
      table={{ head: ["Period", ...series.map((s) => s.label)], align: ["left", ...series.map(() => "right" as const)], rows: points.map((p, i) => [fmtPeriod(p, grain, locale), ...series.map((s) => fmtValue(s.values[i], fmt, locale))]) }}>
      <TimeChart points={points} grain={grain} series={series} fmt={fmt} locale={locale} kind={kind} testId={`chart-${title.toLowerCase().replace(/\W+/g, "-")}`} />
    </ChartCard>
  );
}

async function RankCard({ f, dim, metric, locale, title, description, fmt, limit = 10, enumLabels, href }: {
  f: Filters; dim: Dim; metric: Metric; locale: string; title: string; description?: string; fmt: Fmt; limit?: number; enumLabels?: Record<string, string>; href?: (k: string) => string | undefined;
}) {
  const rows = await barRows(await report(f, [dim], [metric], { limit }), dim, metric, locale, { enumLabels, href });
  return (
    <ChartCard title={title} description={description}
      table={{ head: [title, "Value"], align: ["left", "right"], rows: rows.map((r) => [r.label, fmtValue(r.value, fmt, locale)]) }}>
      <BarList rows={rows} fmt={fmt} locale={locale} emptyText="No data in this period." testId={`bars-${dim}`} />
    </ChartCard>
  );
}

/** Table of a one-dimension report with several figures. */
async function BreakdownTable({ f, dim, metrics, locale, title, limit = 50, href, enumLabels }: {
  f: Filters; dim: Dim; metrics: { m: Metric; label: string; fmt: Fmt }[]; locale: string; title: string; limit?: number; href?: (k: string) => string | undefined; enumLabels?: Record<string, string>;
}) {
  const rows = await report(f, [dim], metrics.map((x) => x.m), { limit });
  const labelled = await barRows(rows, dim, metrics[0].m, locale, { enumLabels, href });
  return (
    <section className="rounded-xl border bg-card">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`table-${dim}`}>
          <thead><tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</th>
            {metrics.map((x) => <th key={x.m} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">{x.label}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={metrics.length + 1} className="px-3 py-8 text-center text-muted-foreground">No data in this period.</td></tr>}
            {rows.map((r, i) => (
              <tr key={labelled[i].key} className="border-b last:border-0">
                <td className="px-3 py-2">{labelled[i].href ? <Link className="text-primary hover:underline" href={labelled[i].href!}>{labelled[i].label}</Link> : labelled[i].label}</td>
                {metrics.map((x) => <td key={x.m} className="px-3 py-2 text-right tabular-nums">{fmtValue(r.values[x.m], x.fmt, locale)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export async function AdminAnalyticsView({ ctx, kind, searchParams }: { ctx: Ctx; kind: AdminReport; searchParams: SearchParams }) {
  const locale = await getLocale();
  const q = await readQuery(ctx, "ADMIN", searchParams, { basis: kind === "revenue" || kind === "gross-margin" ? "delivered" : "placed" });
  const f: Filters = kind === "distributors" ? { ...q.filters, sellerType: "DISTRIBUTOR" } : kind === "wholesalers" ? { ...q.filters, sellerType: "WHOLESALER" } : q.filters;
  const [title, description] = TITLES[kind];
  const countries = await countryOptions(locale);
  const company = (k: string) => (k && k !== "-" ? `/admin/companies/${k}` : undefined);
  const exportSpec: Partial<Record<AdminReport, [Dim[], Metric[]]>> = {
    sales: [[q.grain], ["orders", "net", "gross", "aov"]], revenue: [["month"], ["margin", "fees", "revenue", "commission"]],
    "gross-margin": [["vendor"], ["goodsNet", "payout", "margin"]], orders: [[q.grain], ["orders", "net", "aov"]],
    customers: [["buyer"], ["orders", "net", "aov"]], vendors: [["vendor"], ["orders", "net", "commission", "margin", "payout"]],
    distributors: [["vendor"], ["orders", "net", "commission", "margin", "payout"]], wholesalers: [["vendor"], ["orders", "net", "commission", "margin", "payout"]],
    products: [["product"], ["units", "net", "margin"]], country: [["country"], ["orders", "buyers", "net", "revenue"]],
  };
  const spec = exportSpec[kind];
  const header = (
    <>
      <PageHeader title={title} description={description} actions={spec ? <ExportButtons params={q.params} dims={spec[0]} metrics={spec[1]} /> : undefined} />
      <FilterBar labels={ADMIN_FILTER_LABELS} countries={countries} showType={kind !== "distributors" && kind !== "wholesalers"} showBasis={kind !== "delivery"} defaultBasis={q.filters.basis} />
      {ctx.scopes.length > 0 && <p className="-mt-3 mb-4 text-xs text-muted-foreground">Showing your regions only.</p>}
    </>
  );

  if (kind === "custom") {
    return (
      <>
        {header}
        <ReportBuilder searchParams={searchParams} filters={f} locale={locale} params={q.params} />
      </>
    );
  }

  if (kind === "delivery") {
    const d = await deliveryStats(f);
    const done = d.delivered + d.failed + d.returned;
    const reasonLabels: Record<string, string> = { CUSTOMER_ABSENT: "Nobody there", CLOSED: "Business closed", REFUSED: "Refused", WRONG_ADDRESS: "Wrong address", DAMAGED: "Damaged", NO_ACCESS: "No access", OTHER: "Other" };
    const bars = (rows: { key: string; delivered: number; failed: number }[]) => rows.map((r) => ({ key: r.key, label: ADMIN_ENUMS.deliveryMode[r.key] ?? r.key, value: r.delivered, hint: r.failed ? `${r.failed} failed / returned` : undefined }));
    return (
      <>
        {header}
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Delivered" value={d.delivered} fmt="number" locale={locale} hint={`${done} finished`} testId="kpi-delivered" />
          <Kpi label="Success rate" value={done ? d.delivered / done : 0} fmt="percent" locale={locale} hint={`${d.failed} failed · ${d.returned} returned`} />
          <Kpi label="On time" value={d.scheduled ? d.on_time / d.scheduled : 0} fmt="percent" locale={locale} hint={`of ${d.scheduled} with a scheduled date`} />
          <Kpi label="Average drive" value={d.avg_minutes ?? 0} fmt="number" locale={locale} hint="minutes from pickup to drop-off" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="By delivery mode" table={{ head: ["Mode", "Delivered", "Failed / returned"], align: ["left", "right", "right"], rows: d.byMode.map((r) => [ADMIN_ENUMS.deliveryMode[r.key] ?? r.key, String(r.delivered), String(r.failed)]) }}>
            <BarList rows={bars(d.byMode)} fmt="number" locale={locale} emptyText="No deliveries in this period." />
          </ChartCard>
          <ChartCard title="Failure reasons" description="Failed attempts, including ones later retried." table={{ head: ["Reason", "Attempts"], align: ["left", "right"], rows: d.reasons.map((r) => [reasonLabels[r.key] ?? r.key, String(r.n)]) }}>
            <BarList rows={d.reasons.map((r) => ({ key: r.key, label: reasonLabels[r.key] ?? r.key, value: r.n }))} fmt="number" locale={locale} emptyText="No failed attempts." />
          </ChartCard>
          <ChartCard title="By delivering company" table={{ head: ["Company", "Delivered", "Failed / returned"], align: ["left", "right", "right"], rows: d.byExecutor.map((r) => [r.key, String(r.delivered), String(r.failed)]) }}>
            <BarList rows={bars(d.byExecutor)} fmt="number" locale={locale} emptyText="No deliveries in this period." />
          </ChartCard>
          <ChartCard title="By driver" table={{ head: ["Driver", "Delivered", "Failed / returned"], align: ["left", "right", "right"], rows: d.byDriver.map((r) => [r.key, String(r.delivered), String(r.failed)]) }}>
            <BarList rows={bars(d.byDriver)} fmt="number" locale={locale} emptyText="No driver deliveries in this period." />
          </ChartCard>
        </div>
      </>
    );
  }

  const [k, p] = await Promise.all([kpis(f), kpis(previousPeriod(f))]);
  const tiles = {
    net: <Kpi key="net" label="Net sales" value={k.net} prev={p.net} fmt="money" locale={locale} hint={`Gross ${fmtValue(k.gross, "money", locale)}`} testId="kpi-net" />,
    orders: <Kpi key="orders" label="Orders" value={k.orders} prev={p.orders} fmt="number" locale={locale} hint={`${k.cancelled} cancelled`} testId="kpi-orders" />,
    aov: <Kpi key="aov" label="Average order" value={k.aov} prev={p.aov} fmt="money" locale={locale} />,
    buyers: <Kpi key="buyers" label="Active buyers" value={k.buyers} prev={p.buyers} fmt="number" locale={locale} />,
    revenue: <Kpi key="revenue" label="FIRINGI revenue" value={k.revenue} prev={p.revenue} fmt="money" locale={locale} hint="margin + delivery fees" testId="kpi-revenue" />,
    margin: <Kpi key="margin" label="Goods margin" value={k.margin} prev={p.margin} fmt="money" locale={locale} hint={`${fmtValue(k.net - k.fees ? k.margin / (k.net - k.fees) : 0, "percent", locale)} of goods`} />,
    fees: <Kpi key="fees" label="Delivery fees" value={k.fees} prev={p.fees} fmt="money" locale={locale} />,
    commission: <Kpi key="commission" label="Commission" value={k.commission} prev={p.commission} fmt="money" locale={locale} />,
    credited: <Kpi key="credited" label="Credit notes" value={k.credited} prev={p.credited} fmt="money" locale={locale} hint="issued in the period (net)" />,
    payout: <Kpi key="payout" label="Owed to vendors" value={k.payout} prev={p.payout} fmt="money" locale={locale} />,
  };
  const row = (...xs: (keyof typeof tiles)[]) => <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{xs.map((x) => tiles[x])}</div>;
  const g = q.grain;

  switch (kind) {
    case "sales":
      return (
        <>
          {header}
          {row("net", "orders", "aov", "buyers")}
          <div className="grid gap-4">
            <TimeCard f={f} grain={g} locale={locale} title="Net sales" metrics={[{ m: "net", label: "This period" }]} fmt="money" compare />
            <div className="grid gap-4 lg:grid-cols-2">
              <RankCard f={f} dim="vendor" metric="net" locale={locale} title="Top vendors" fmt="money" href={company} />
              <RankCard f={f} dim="product" metric="net" locale={locale} title="Top products" fmt="money" />
              <RankCard f={f} dim="country" metric="net" locale={locale} title="By country" fmt="money" />
              <RankCard f={f} dim="flow" metric="net" locale={locale} title="By marketplace" fmt="money" enumLabels={ADMIN_ENUMS.flow} />
            </div>
          </div>
        </>
      );
    case "revenue": {
      const [rows, credits] = await Promise.all([report({ ...f }, ["month"], ["margin", "fees", "revenue"]), creditNotesByMonth(f)]);
      const { points, values } = fillSeries(rows, "month", f.from, f.to, ["margin", "fees", "revenue"]);
      const cn = new Map(credits.map((c) => [c.month, c.net]));
      return (
        <>
          {header}
          {row("revenue", "margin", "fees", "credited")}
          <div className="grid gap-4">
            <TimeCard f={f} grain={g} locale={locale} title="Revenue over time" description="Goods margin and delivery fees per period." metrics={[{ m: "margin", label: "Goods margin" }, { m: "fees", label: "Delivery fees" }]} fmt="money" kind="bar" />
            <section className="overflow-x-auto rounded-xl border bg-card">
              <h2 className="border-b px-4 py-3 text-sm font-semibold">Revenue by month</h2>
              <table className="w-full text-sm" data-testid="table-revenue-month">
                <thead><tr className="border-b bg-muted/50">{["Month", "Goods margin", "Delivery fees", "Revenue", "Credit notes (net)"].map((h, i) => <th key={h} className={`px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
                <tbody>{points.map((pt, i) => (
                  <tr key={pt} className="border-b last:border-0">
                    <td className="px-3 py-2">{fmtPeriod(pt, "month", locale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtValue(values.margin[i], "money", locale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtValue(values.fees[i], "money", locale)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtValue(values.revenue[i], "money", locale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{cn.get(pt) ? fmtValue(cn.get(pt)!, "money", locale) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </section>
          </div>
        </>
      );
    }
    case "gross-margin":
      return (
        <>
          {header}
          {row("margin", "commission", "payout", "net")}
          <div className="grid gap-4">
            <TimeCard f={f} grain={g} locale={locale} title="Goods margin" metrics={[{ m: "margin", label: "This period" }]} fmt="money" compare />
            <div className="grid gap-4 lg:grid-cols-2">
              <RankCard f={f} dim="categoryRoot" metric="margin" locale={locale} title="Margin by category" fmt="money" />
              <RankCard f={f} dim="flow" metric="margin" locale={locale} title="Margin by marketplace" fmt="money" enumLabels={ADMIN_ENUMS.flow} />
            </div>
            <BreakdownTable f={f} dim="vendor" locale={locale} title="Margin by vendor" href={company}
              metrics={[{ m: "goodsNet", label: "Goods sold", fmt: "money" }, { m: "payout", label: "Owed to vendor", fmt: "money" }, { m: "commission", label: "Commission", fmt: "money" }, { m: "margin", label: "Margin", fmt: "money" }]} />
          </div>
        </>
      );
    case "orders": {
      const funnel = await statusFunnel(f);
      return (
        <>
          {header}
          {row("orders", "aov", "net", "buyers")}
          <div className="grid gap-4">
            <TimeCard f={f} grain={g} locale={locale} title="Orders" metrics={[{ m: "orders", label: "This period" }]} fmt="number" kind="bar" compare />
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Where orders are now" description="Orders placed in the period, by current status (including cancelled)."
                table={{ head: ["Status", "Orders", "Net"], align: ["left", "right", "right"], rows: funnel.map((r) => [ADMIN_ENUMS.status[r.status] ?? r.status, String(r.n), fmtValue(r.net, "money", locale)]) }}>
                <BarList rows={funnel.map((r) => ({ key: r.status, label: ADMIN_ENUMS.status[r.status] ?? r.status, value: r.n }))} fmt="number" locale={locale} emptyText="No orders in this period." testId="bars-status" />
              </ChartCard>
              <RankCard f={f} dim="deliveryMode" metric="orders" locale={locale} title="By delivery mode" fmt="number" enumLabels={ADMIN_ENUMS.deliveryMode} />
            </div>
          </div>
        </>
      );
    }
    case "customers": {
      const [mix, prevMix] = await Promise.all([buyerMix(f), buyerMix(previousPeriod(f))]);
      return (
        <>
          {header}
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Active buyers" value={mix.active} prev={prevMix.active} fmt="number" locale={locale} testId="kpi-buyers" />
            <Kpi label="First-time buyers" value={mix.fresh} prev={prevMix.fresh} fmt="number" locale={locale} />
            <Kpi label="Returning buyers" value={mix.returning} prev={prevMix.returning} fmt="number" locale={locale} />
            {tiles.aov}
          </div>
          <div className="grid gap-4">
            <TimeCard f={f} grain={g} locale={locale} title="Active buyers" metrics={[{ m: "buyers", label: "Buyers" }]} fmt="number" kind="bar" />
            <div className="grid gap-4 lg:grid-cols-2">
              <RankCard f={f} dim="country" metric="buyers" locale={locale} title="Buyers by country" fmt="number" />
              <RankCard f={f} dim="region" metric="buyers" locale={locale} title="Buyers by delivery region" fmt="number" />
            </div>
            <BreakdownTable f={f} dim="buyer" locale={locale} title="Top buyers" href={company}
              metrics={[{ m: "orders", label: "Orders", fmt: "number" }, { m: "net", label: "Net", fmt: "money" }, { m: "aov", label: "Average order", fmt: "money" }]} />
          </div>
        </>
      );
    }
    case "vendors":
    case "distributors":
    case "wholesalers":
      return (
        <>
          {header}
          {row("net", "orders", "commission", "margin")}
          <div className="grid gap-4">
            <RankCard f={f} dim="vendor" metric="net" locale={locale} title="Sales by vendor" fmt="money" limit={15} href={company} />
            <BreakdownTable f={f} dim="vendor" locale={locale} title="All vendors" href={company}
              metrics={[{ m: "orders", label: "Orders", fmt: "number" }, { m: "buyers", label: "Buyers", fmt: "number" }, { m: "net", label: "Net", fmt: "money" }, { m: "commission", label: "Commission", fmt: "money" }, { m: "margin", label: "Margin", fmt: "money" }, { m: "payout", label: "Owed", fmt: "money" }]} />
          </div>
        </>
      );
    case "products":
      return (
        <>
          {header}
          <div className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <RankCard f={f} dim="product" metric="net" locale={locale} title="Top products by value" fmt="money" />
              <RankCard f={f} dim="product" metric="units" locale={locale} title="Top products by units" fmt="number" />
              <RankCard f={f} dim="categoryRoot" metric="net" locale={locale} title="Sales by category" fmt="money" />
              <RankCard f={f} dim="category" metric="net" locale={locale} title="Sales by sub-category" fmt="money" />
            </div>
            <BreakdownTable f={f} dim="product" locale={locale} title="Products"
              metrics={[{ m: "units", label: "Units", fmt: "number" }, { m: "orders", label: "Orders", fmt: "number" }, { m: "net", label: "Net", fmt: "money" }, { m: "margin", label: "Margin", fmt: "money" }]} />
          </div>
        </>
      );
    case "country":
      return (
        <>
          {header}
          {row("net", "revenue", "orders", "buyers")}
          <div className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <RankCard f={f} dim="country" metric="net" locale={locale} title="Net sales by buyer country" fmt="money" />
              <RankCard f={f} dim="sellerCountry" metric="net" locale={locale} title="Net sales by seller country" description="Cross-border supply shows here." fmt="money" />
            </div>
            <BreakdownTable f={f} dim="country" locale={locale} title="Markets"
              metrics={[{ m: "orders", label: "Orders", fmt: "number" }, { m: "buyers", label: "Buyers", fmt: "number" }, { m: "net", label: "Net", fmt: "money" }, { m: "revenue", label: "FIRINGI revenue", fmt: "money" }, { m: "aov", label: "Average order", fmt: "money" }]} />
          </div>
        </>
      );
  }
}
