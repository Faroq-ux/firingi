import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { ForecastSpark } from "@/components/ai/forecast-chart";
import { demandForecast } from "@/server/ai/insights";
import { NoAccess, SuggestOnly, aiPage, pct } from "../_kit";

export const metadata = { title: "Demand Forecasting" };

export default async function Page() {
  const DATA = ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"] as const;
  const { ctx, allowed } = await aiPage([...DATA]);
  const header = <PageHeader title="Demand Forecasting" description="Units per product for the next 4 weeks, learned from the last 12 weeks of orders (trend-following smoothing). Solid line: what sold; dashed: the forecast." />;
  if (!allowed) return <>{header}<NoAccess what="order volumes" /></>;
  const rows = await demandForecast(ctx, "STAFF", { limit: 100 });
  const rising = rows.filter((r) => (r.trend ?? 0) >= 0.15).length, falling = rows.filter((r) => (r.trend ?? 0) <= -0.15).length;
  return (
    <>
      {header}
      <SuggestOnly />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="demand-kpis">
        <Kpi label="Products forecast" value={rows.length} fmt="number" locale="en" index={0} />
        <Kpi label="Units next 4 weeks" value={rows.reduce((a, r) => a + r.nextWeeks, 0)} fmt="number" locale="en" index={1} />
        <Kpi label="Rising (≥ +15%)" value={rising} fmt="number" locale="en" index={2} />
        <Kpi label="Falling (≤ −15%)" value={falling} fmt="number" locale="en" index={3} />
      </div>
      <Card><CardContent className="pt-4">
        <Table data-testid="demand-table">
          <THead><TR><TH>Product</TH><TH>Supplier</TH><TH className="w-48">12 weeks → 4 weeks</TH><TH className="text-right">Last 4 wk</TH><TH className="text-right">Next 4 wk</TH><TH className="text-right">Trend</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.offerId}>
                <TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD>
                <TD>{r.vendor}</TD>
                <TD><ForecastSpark history={r.history} forecast={r.forecast} label={`${r.product}: ${r.lastWeeks} units in the last 4 weeks, about ${r.nextWeeks} in the next 4`} /></TD>
                <TD className="text-right tabular-nums">{r.lastWeeks}</TD>
                <TD className="text-right font-semibold tabular-nums">{r.nextWeeks}</TD>
                <TD className={`text-right tabular-nums ${(r.trend ?? 0) > 0.05 ? "text-success" : (r.trend ?? 0) < -0.05 ? "text-destructive" : ""}`}>{pct(r.trend)}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={6}>No orders in the last 12 weeks to learn from.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
