import { LineChart } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { ForecastSpark } from "@/components/ai/forecast-chart";
import { aiCentreSettings } from "@/server/ai/centre/settings";
import { canForecast, forecastCash, forecastDelivery, forecastDemand, forecastInventory, forecastOrders, forecastSales, type Series } from "@/server/ai/centre/forecasts";
import { FORECAST_LABEL, FORECASTS, type ForecastKind } from "@/lib/ai-centre";
import { Level, NoAccess, SuggestOnly, TabLinks, aiPage, eur, num, pct } from "../_kit";

export const metadata = { title: "Forecasting" };
export const dynamic = "force-dynamic";

function SeriesTable({ rows, money, what, testid }: { rows: Series[]; money?: boolean; what: string; testid: string }) {
  const f = (n: number) => (money ? eur(n) : num(n));
  return (
    <Table data-testid={testid}>
      <THead><TR><TH>{what}</TH><TH className="w-48">16 weeks → 8 weeks</TH><TH className="text-right">Last 4 wk</TH><TH className="text-right">Next 4 wk</TH><TH className="text-right">Trend</TH></TR></THead>
      <TBody>
        {rows.slice(0, 40).map((s) => (
          <TR key={s.key}><TD className="font-medium">{s.label}</TD><TD><ForecastSpark history={s.history} forecast={s.forecast} label={`${s.label}: ${f(s.last4)} in the last 4 weeks, about ${f(s.next4)} in the next 4`} /></TD>
            <TD className="text-right tabular-nums">{f(s.last4)}</TD><TD className="text-right font-semibold tabular-nums">{f(s.next4)}</TD><TD className={`text-right tabular-nums ${(s.trend ?? 0) > 0.05 ? "text-success" : (s.trend ?? 0) < -0.05 ? "text-destructive" : ""}`}>{pct(s.trend)}</TD></TR>
        ))}
        {!rows.length && <EmptyRow colSpan={5}>Not enough history to forecast.</EmptyRow>}
      </TBody>
    </Table>
  );
}
const Big = ({ s, money, label }: { s: Series; money?: boolean; label: string }) => (
  <Card className="mb-6"><CardHeader><CardTitle>{label}</CardTitle><CardDescription>Solid: what happened (16 weeks). Dashed: the forecast (8 weeks).</CardDescription></CardHeader>
    <CardContent><ForecastSpark history={s.history} forecast={s.forecast} height={120} label={`${label}: about ${money ? eur(s.next4) : num(s.next4)} in the next 4 weeks`} /></CardContent></Card>
);

export default async function ForecastingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { ctx } = await aiPage();
  const s = await aiCentreSettings();
  const tabs = FORECASTS.filter((k) => s.forecasts[k]);
  const sp = await searchParams;
  const tab = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as ForecastKind) : tabs[0];
  const header = <PageHeader title="Forecasting" icon={LineChart} description="What the coming weeks are likely to bring — demand, sales, orders, inventory, cash and deliveries — learned from the last weeks with trend-following smoothing." />;
  if (!tab) return <>{header}<p className="text-sm text-muted-foreground">Every forecast is switched off in the AI Centre settings.</p></>;
  const nav = <TabLinks testid="fc-tabs" active={tab} href={(k) => `/admin/ai/forecasting?tab=${k}`} tabs={tabs.map((k) => ({ key: k, label: FORECAST_LABEL[k] }))} />;
  if (!canForecast(ctx, tab)) return <>{header}{nav}<NoAccess what={`${FORECAST_LABEL[tab].toLowerCase()} data`} /></>;
  let body: React.ReactNode = null;

  if (tab === "DEMAND") {
    const rows = await forecastDemand(ctx);
    body = (<>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fc-kpis">
        <Kpi label="Products forecast" value={rows.length} fmt="number" locale="en" index={0} /><Kpi label="Units next 4 weeks" value={rows.reduce((a, r) => a + r.nextWeeks, 0)} fmt="number" locale="en" index={1} />
        <Kpi label="Rising (≥ +15%)" value={rows.filter((r) => (r.trend ?? 0) >= 0.15).length} fmt="number" locale="en" index={2} /><Kpi label="Falling (≤ −15%)" value={rows.filter((r) => (r.trend ?? 0) <= -0.15).length} fmt="number" locale="en" index={3} />
      </div>
      <Card><CardContent className="overflow-x-auto pt-4"><Table data-testid="fc-demand"><THead><TR><TH>Product</TH><TH>Supplier</TH><TH className="w-48">12 weeks → 4 weeks</TH><TH className="text-right">Last 4 wk</TH><TH className="text-right">Next 4 wk</TH><TH className="text-right">Trend</TH></TR></THead>
        <TBody>{rows.slice(0, 100).map((r) => <TR key={r.offerId}><TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD><TD>{r.vendor}</TD><TD><ForecastSpark history={r.history} forecast={r.forecast} label={`${r.product}: about ${r.nextWeeks} in the next 4 weeks`} /></TD><TD className="text-right tabular-nums">{r.lastWeeks}</TD><TD className="text-right font-semibold tabular-nums">{r.nextWeeks}</TD><TD className="text-right tabular-nums">{pct(r.trend)}</TD></TR>)}
          {!rows.length && <EmptyRow colSpan={6}>No orders in the last 12 weeks to learn from.</EmptyRow>}</TBody></Table></CardContent></Card>
    </>);
  } else if (tab === "SALES") {
    const f = await forecastSales(ctx);
    body = (<>
      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="fc-kpis"><Kpi label="Net sales, last 4 weeks" value={f.total.last4} fmt="money" locale="en" index={0} /><Kpi label="Forecast, next 4 weeks" value={f.total.next4} fmt="money" locale="en" index={1} /><Kpi label="Forecast, next 8 weeks" value={f.total.forecast.reduce((a, b) => a + b, 0)} fmt="money" locale="en" index={2} /></div>
      <Big s={f.total} money label="All sales (net, excl. VAT)" />
      <Card><CardHeader><CardTitle>By supplier</CardTitle></CardHeader><CardContent className="overflow-x-auto"><SeriesTable rows={f.suppliers} money what="Supplier" testid="fc-sales" /></CardContent></Card>
    </>);
  } else if (tab === "ORDERS") {
    const f = await forecastOrders(ctx);
    body = (<>
      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="fc-kpis"><Kpi label="Orders, last 4 weeks" value={f.total.last4} fmt="number" locale="en" index={0} /><Kpi label="Forecast, next 4 weeks" value={Math.round(f.total.next4)} fmt="number" locale="en" index={1} /><Kpi label="Next week" value={Math.round(f.total.forecast[0] ?? 0)} fmt="number" locale="en" index={2} /></div>
      <Big s={f.total} label="Orders per week" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>By country</CardTitle></CardHeader><CardContent className="overflow-x-auto"><SeriesTable rows={f.countries} what="Country" testid="fc-orders" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Next week by weekday</CardTitle><CardDescription>From the usual share of each weekday over the last 8 weeks.</CardDescription></CardHeader><CardContent>
          <ul className="space-y-2" data-testid="fc-weekdays">{f.weekdays.map((d) => <li key={d.day} className="flex items-center gap-3 text-sm"><span className="w-10">{d.day}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${d.share}%` }} /></span><span className="w-24 text-right tabular-nums">≈ {d.expectedNextWeek} ({d.share}%)</span></li>)}</ul>
        </CardContent></Card>
      </div>
    </>);
  } else if (tab === "INVENTORY") {
    const f = await forecastInventory(ctx);
    body = (<>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fc-kpis"><Kpi label="Out of stock" value={f.out} fmt="number" locale="en" index={0} /><Kpi label="Critical" value={f.critical} fmt="number" locale="en" index={1} /><Kpi label="Low cover" value={f.low} fmt="number" locale="en" index={2} /><Kpi label="Run out within 2 weeks" value={f.runOutTwoWeeks} fmt="number" locale="en" index={3} /></div>
      <Card><CardContent className="overflow-x-auto pt-4"><Table data-testid="fc-inventory"><THead><TR><TH>Product</TH><TH>Supplier</TH><TH className="text-right">Available</TH><TH className="text-right">Sells / day</TH><TH className="text-right">Days left</TH><TH>Runs out</TH><TH className="text-right">Next 2 weeks</TH><TH /></TR></THead>
        <TBody>{f.rows.slice(0, 120).map((r) => <TR key={r.offerId}><TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD><TD>{r.vendor}</TD><TD className="text-right tabular-nums">{r.available}</TD><TD className="text-right tabular-nums">{num(r.dailyUnits)}</TD><TD className="text-right tabular-nums">{r.days ?? "—"}</TD><TD className="tabular-nums">{r.runsOutOn ?? "—"}</TD><TD className="text-right tabular-nums">{r.nextTwoWeeks}</TD><TD><Level value={r.status} /></TD></TR>)}
          {!f.rows.length && <EmptyRow colSpan={8}>No products selling.</EmptyRow>}</TBody></Table></CardContent></Card>
    </>);
  } else if (tab === "CASH") {
    const f = await forecastCash(ctx);
    body = (<>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fc-kpis"><Kpi label="Coming in, 8 weeks" value={f.inNext8} fmt="money" locale="en" index={0} /><Kpi label="Going out, 8 weeks" value={f.outNext8} fmt="money" locale="en" index={1} /><Kpi label="Lowest point" value={f.lowest} fmt="money" locale="en" index={2} /><Kpi label="Overdue from customers" value={f.overdueReceivable} fmt="money" locale="en" index={3} /></div>
      <Card className="mb-6"><CardHeader><CardTitle>Running balance, next 8 weeks</CardTitle><CardDescription>Money customers owe by due date, less what FIRINGI owes suppliers and its running monthly costs.</CardDescription></CardHeader>
        <CardContent><ForecastSpark history={f.history.map((h) => h.cumulative)} forecast={f.forecast.map((x) => x.cumulative)} height={110} label="Cash: history by month (solid) and weeks ahead (dashed)" /></CardContent></Card>
      <Card><CardContent className="overflow-x-auto pt-4"><Table data-testid="fc-cash"><THead><TR><TH>Week</TH><TH className="text-right">In (customers)</TH><TH className="text-right">Out (suppliers)</TH><TH className="text-right">Costs</TH><TH className="text-right">Net</TH><TH className="text-right">Running</TH></TR></THead>
        <TBody>{f.forecast.map((w) => <TR key={w.week}><TD className="tabular-nums">{w.week}</TD><TD className="text-right tabular-nums">{eur(w.receivable)}</TD><TD className="text-right tabular-nums">{eur(w.payable)}</TD><TD className="text-right tabular-nums">{eur(w.costs)}</TD><TD className={`text-right tabular-nums ${w.net < 0 ? "text-destructive" : ""}`}>{eur(w.net)}</TD><TD className="text-right font-semibold tabular-nums">{eur(w.cumulative)}</TD></TR>)}</TBody></Table></CardContent></Card>
    </>);
  } else {
    const f = await forecastDelivery(ctx);
    body = (<>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fc-kpis"><Kpi label="Deliveries, next 4 weeks" value={Math.round(f.total.next4)} fmt="number" locale="en" index={0} /><Kpi label="Next week" value={Math.round(f.total.forecast[0] ?? 0)} fmt="number" locale="en" index={1} /><Kpi label="Active drivers" value={f.drivers} fmt="number" locale="en" index={2} /><Kpi label="Drivers needed next week" value={f.driversNeededNextWeek ?? 0} fmt="number" locale="en" index={3} /></div>
      <Big s={f.total} label="Deliveries per week" />
      <Card><CardHeader><CardTitle>Late deliveries</CardTitle><CardDescription>Share delivered more than a day after the requested date, per week{f.lateTrend !== null ? ` — ${pct(f.lateTrend)} over the last 4 weeks` : ""}. {f.perDriverWeek !== null ? `About ${f.perDriverWeek} deliveries per driver a week.` : ""}</CardDescription></CardHeader>
        <CardContent><ForecastSpark history={f.lateShare} forecast={[]} height={70} label="Late deliveries (%) per week" /></CardContent></Card>
    </>);
  }
  return <>{header}<SuggestOnly />{nav}{body}</>;
}
