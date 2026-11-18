import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { deliveryPerformance, periodFrom } from "@/server/services/route-stats";
import { routingSettings } from "@/server/services/routes";
import { PageHeader } from "@/components/layout/page-header";
import { Kpi } from "@/components/analytics/kit";
import { BarList, ChartCard, TimeChart } from "@/components/analytics/charts";
import { PeriodForm } from "@/components/routes/period-form";

export const metadata = { title: "Delivery Performance" };
const REASON: Record<string, string> = { CUSTOMER_ABSENT: "Customer not there", CLOSED: "Business closed", REFUSED: "Refused", WRONG_ADDRESS: "Wrong address", DAMAGED: "Goods damaged", NO_ACCESS: "No access", TEMPERATURE: "Temperature out of range", OTHER: "Other" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage", "admin.analytics.view"]);
  const sp = await searchParams;
  const all = sp.all === "1";
  const p = periodFrom(sp);
  const [r, s] = await Promise.all([deliveryPerformance(ctx, p, all), routingSettings()]);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const pct = (v: number | null) => (v === null ? NaN : v);
  return (
    <>
      <PageHeader title="Delivery Performance" description={`${all ? "All fleets" : "FIRINGI's fleet"} (carrier shipments excluded). On time = delivered no later than the planned arrival + ${s.etaWindowMinutes / 2} min (half the customer window).`} />
      <div className="mb-2 flex flex-wrap gap-1 text-sm">
        <a href={`?from=${d(p.from)}&to=${d(p.to)}`} className={`rounded-md border px-3 py-1 ${!all ? "bg-primary text-primary-foreground" : ""}`}>FIRINGI fleet</a>
        <a href={`?from=${d(p.from)}&to=${d(p.to)}&all=1`} className={`rounded-md border px-3 py-1 ${all ? "bg-primary text-primary-foreground" : ""}`}>All fleets</a>
      </div>
      <PeriodForm from={d(p.from)} to={d(p.to)} extra={all ? { all: "1" } : undefined} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6" data-testid="delivery-kpis">
        <Kpi label="Delivered" value={r.delivered} fmt="number" locale="en" />
        <Kpi label="Failed / returned" value={r.failed} fmt="number" locale="en" />
        <Kpi label="On time" value={pct(r.onTimeRate)} fmt="percent" locale="en" hint={`${r.timed} with a planned time`} />
        <Kpi label="First attempt" value={pct(r.firstTryRate)} fmt="percent" locale="en" />
        <Kpi label="Order → delivered" value={r.medianLeadHours ?? NaN} fmt="number" locale="en" hint="median, hours" />
        <Kpi label="Delay vs plan" value={r.medianDelayMinutes ?? NaN} fmt="number" locale="en" hint="median, minutes" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartCard title="Deliveries per day" description="Delivered and failed, by day of completion."
          table={{ head: ["Day", "Delivered", "Failed", "On time"], rows: r.days.map((x) => [x.day, String(x.delivered), String(x.failed), x.timed ? `${Math.round((x.onTime / x.timed) * 100)} %` : "—"]), align: ["left", "right", "right", "right"] }}>
          <TimeChart points={r.days.map((x) => x.day)} grain="day" kind="bar" fmt="number" locale="en" testId="deliveries-per-day"
            series={[{ key: "delivered", label: "Delivered", values: r.days.map((x) => x.delivered) }, { key: "failed", label: "Failed", values: r.days.map((x) => x.failed) }]} />
        </ChartCard>
        <ChartCard title="Why deliveries failed" table={{ head: ["Reason", "Attempts"], rows: r.reasons.map((x) => [REASON[x.code] ?? x.code, String(x.count)]), align: ["left", "right"] }}>
          <BarList rows={r.reasons.map((x) => ({ key: x.code, label: REASON[x.code] ?? x.code, value: x.count }))} fmt="number" locale="en" emptyText="No failed attempts." />
        </ChartCard>
      </div>
    </>
  );
}
