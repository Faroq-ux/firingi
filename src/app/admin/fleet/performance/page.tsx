import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { driverPerformance, periodFrom } from "@/server/services/route-stats";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { fmtValue } from "@/lib/analytics-format";
import { PeriodForm } from "@/components/routes/period-form";

export const metadata = { title: "Driver Performance" };
const pct = (v: number | null) => (v === null ? "—" : fmtValue(v, "percent", "en"));

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"]);
  const sp = await searchParams;
  const all = sp.all === "1";
  const p = periodFrom(sp);
  const rows = await driverPerformance(ctx, p, all);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Driver Performance" description="Deliveries, success and punctuality per driver. Hours are from route start to route end." />
      <div className="mb-2 flex flex-wrap gap-1 text-sm">
        <a href={`?from=${d(p.from)}&to=${d(p.to)}`} className={`rounded-md border px-3 py-1 ${!all ? "bg-primary text-primary-foreground" : ""}`}>FIRINGI drivers</a>
        <a href={`?from=${d(p.from)}&to=${d(p.to)}&all=1`} className={`rounded-md border px-3 py-1 ${all ? "bg-primary text-primary-foreground" : ""}`}>All drivers</a>
      </div>
      <PeriodForm from={d(p.from)} to={d(p.to)} extra={all ? { all: "1" } : undefined} />
      <Card>
        <CardContent className="pt-5">
          <Table data-testid="driver-performance">
            <THead><TR><TH>Driver</TH>{all && <TH>Fleet</TH>}<TH className="text-right">Routes</TH><TH className="text-right">Delivered</TH><TH className="text-right">Failed</TH><TH className="text-right">Success</TH><TH className="text-right">On time</TH><TH className="text-right">Km</TH><TH className="text-right">Hours</TH><TH className="text-right">Per hour</TH><TH>Now</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.name}{r.status === "SUSPENDED" && <Badge variant="secondary" className="ml-2">Suspended</Badge>}</TD>
                  {all && <TD>{r.fleet}</TD>}
                  <TD className="text-right tabular-nums">{r.routes}</TD>
                  <TD className="text-right tabular-nums">{r.delivered}</TD>
                  <TD className="text-right tabular-nums">{r.failed}</TD>
                  <TD className="text-right tabular-nums">{pct(r.successRate)}</TD>
                  <TD className="text-right tabular-nums">{pct(r.onTimeRate)}</TD>
                  <TD className="text-right tabular-nums">{r.km.toFixed(1)}</TD>
                  <TD className="text-right tabular-nums">{r.hours.toFixed(1)}</TD>
                  <TD className="text-right tabular-nums">{r.perHour === null ? "—" : r.perHour.toFixed(1)}</TD>
                  <TD>{r.availability === "AVAILABLE" ? "Available" : r.availability === "BUSY" ? "On delivery" : "Off duty"}</TD>
                </TR>
              ))}
              {!rows.length && <EmptyRow colSpan={all ? 11 : 10}>No drivers.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
