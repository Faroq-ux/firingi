import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { listRoutes, plannableDeliveries } from "@/server/services/routes";
import { NoAccess, SuggestOnly, aiPage, num } from "../_kit";

export const metadata = { title: "Route Optimization" };
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "no date");

/**
 * Where FIRINGI's own fleet could save: deliveries not yet on a route grouped by day and
 * region (each group is one auto-plan away from a route), and today's routes running late.
 */
export default async function Page() {
  const { ctx, allowed } = await aiPage(["admin.delivery.manage"]);
  const header = <PageHeader title="Route Optimization" description="Deliveries for FIRINGI's own fleet that aren't on a route yet, grouped by day and region — each group can become one optimised route. The planner builds and orders the stops." actions={<Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/admin/delivery/route-optimization">Open the route planner →</Link>} />;
  if (!allowed) return <>{header}<NoAccess what="delivery planning" /></>;
  const today = new Date();
  const [open, routes] = await Promise.all([plannableDeliveries(ctx), listRoutes(ctx, { date: today })]);
  const groups = new Map<string, { date: string; region: string; n: number; cities: Set<string> }>();
  for (const d of open) {
    const k = `${day(d.requested)}|${d.region}`;
    const g = groups.get(k) ?? { date: day(d.requested), region: d.region, n: 0, cities: new Set<string>() };
    g.n++; g.cities.add(d.city); groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || b.n - a.n);
  const late = routes.filter((r) => r.late > 0);
  return (
    <>
      {header}
      <SuggestOnly />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="route-kpis">
        <Kpi label="Deliveries without a route" value={open.length} fmt="number" locale="en" index={0} />
        <Kpi label="Possible routes (day × region)" value={rows.length} fmt="number" locale="en" index={1} />
        <Kpi label="Routes today" value={routes.length} fmt="number" locale="en" index={2} />
        <Kpi label="Routes running late" value={late.length} fmt="number" locale="en" index={3} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Plan these together</CardTitle></CardHeader><CardContent>
          <Table data-testid="route-groups">
            <THead><TR><TH>Day</TH><TH>Region</TH><TH className="text-right">Deliveries</TH><TH>Cities</TH></TR></THead>
            <TBody>
              {rows.map((g) => <TR key={`${g.date}${g.region}`}><TD className="tabular-nums">{g.date}</TD><TD>{g.region}</TD><TD className="text-right font-semibold tabular-nums">{g.n}</TD><TD className="text-xs text-muted-foreground">{[...g.cities].slice(0, 5).join(", ")}</TD></TR>)}
              {!rows.length && <EmptyRow colSpan={4}>Every delivery is on a route.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Today&apos;s routes</CardTitle></CardHeader><CardContent>
          <Table data-testid="route-today">
            <THead><TR><TH>Route</TH><TH>Driver</TH><TH className="text-right">Stops</TH><TH className="text-right">km</TH><TH className="text-right">Late stops</TH></TR></THead>
            <TBody>
              {routes.map((r) => <TR key={r.id}><TD className="font-medium">{r.number}</TD><TD>{r.driver}</TD><TD className="text-right tabular-nums">{r.done}/{r.total}</TD><TD className="text-right tabular-nums">{num(r.plannedKm)}</TD><TD className={`text-right tabular-nums ${r.late ? "font-semibold text-destructive" : ""}`}>{r.late}</TD></TR>)}
              {!routes.length && <EmptyRow colSpan={5}>No routes today.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
    </>
  );
}
