import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { liveBoard } from "@/server/services/route-stats";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { hm } from "@/components/routes/route-views";
import { AutoRefresh } from "@/components/routes/auto-refresh";
import { liveMapRoutes } from "@/server/data/dashboard";
import { RouteMap } from "@/components/motion/route-map";
import { CountUp } from "@/components/motion/count-up";
import { LiveDot } from "@/components/motion/shapes";

export const metadata = { title: "Live Operations" };
export const dynamic = "force-dynamic";
const ST: Record<string, { label: string; v: "default" | "warning" | "success" | "secondary" }> = { PLANNED: { label: "Planned", v: "warning" }, IN_PROGRESS: { label: "On the road", v: "default" }, COMPLETED: { label: "Completed", v: "success" }, CANCELLED: { label: "Cancelled", v: "secondary" } };

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.dashboard.view", "admin.delivery.view", "admin.delivery.manage"]);
  const all = (await searchParams).all === "1";
  const [{ rows, kpi }, mapRoutes] = await Promise.all([liveBoard(ctx, all), liveMapRoutes(all ? {} : { executingCompanyId: ctx.company.id })]);
  const TONES = ["tone-blue", "tone-violet", "tone-teal", "tone-pink", "tone-lime", "tone-orange", "tone-blue"];
  let n = 0;
  const tile = (label: string, value: number, href?: string, tone = "") => {
    const i = n++;
    const body = <><div className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_oklch,var(--tone)_70%,var(--foreground))]">{label}</div><div className={`text-2xl font-bold tabular-nums ${tone}`}><CountUp value={value} fmt="int" /></div></>;
    const cls = `tile gloss motion-rise motion-lift rounded-xl border p-3 ${TONES[i % TONES.length]}`;
    return href ? <Link href={href} className={cls} style={{ ["--i" as string]: i }}>{body}</Link> : <div className={cls} style={{ ["--i" as string]: i }}>{body}</div>;
  };
  return (
    <>
      <PageHeader title="Live Operations" description={<span>Routes on the road today: what is next and what is late. Refreshes every 30 seconds. <AutoRefresh seconds={30} /></span>} />
      <div className="mb-2 flex flex-wrap gap-1 text-sm">
        <Link href="?" className={`rounded-md border px-3 py-1 ${!all ? "bg-primary text-primary-foreground" : ""}`}>FIRINGI fleet</Link>
        <Link href="?all=1" className={`rounded-md border px-3 py-1 ${all ? "bg-primary text-primary-foreground" : ""}`}>All fleets</Link>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8" data-testid="live-kpis">
        {tile("On the road", kpi.running, "/admin/delivery/routes", "text-primary")}
        {tile("Planned", kpi.planned, "/admin/delivery/routes")}
        {tile("Waiting for a route", kpi.waiting, "/admin/delivery/multi-stop", kpi.waiting ? "text-warning" : "")}
        {tile("Late stops", kpi.lateStops, "/admin/delivery/eta", kpi.lateStops ? "text-destructive" : "")}
        {tile("Delivered today", kpi.deliveredToday, undefined, "text-success")}
        {tile("Failed (open)", kpi.failed, "/admin/delivery/failed", kpi.failed ? "text-destructive" : "")}
        {tile("Open exceptions", kpi.exceptions, "/admin/orders/exceptions")}
        <div className="tile gloss tone-violet motion-rise rounded-xl border p-3"><div className="text-xs font-semibold uppercase tracking-wide">Drivers</div><div className="text-sm tabular-nums"><span className="text-success">{kpi.drivers.available} free</span> · {kpi.drivers.busy} busy · <span className="text-muted-foreground">{kpi.drivers.off} off</span></div></div>
      </div>
      <Card className="mb-4 motion-rise" style={{ ["--i" as string]: 8 }}>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Live map</CardTitle><LiveDot label="Live" /></CardHeader>
        <CardContent>{mapRoutes.length ? <RouteMap routes={mapRoutes.map((r) => ({ ...r, href: `/admin/delivery/routes/${r.id}` }))} label="Routes on the road" height={340} /> : <p className="py-8 text-center text-sm text-muted-foreground">No routes on the road right now.</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Routes today</CardTitle></CardHeader>
        <CardContent>
          <Table data-testid="live-routes">
            <THead><TR><TH>Route</TH><TH>Driver</TH>{all && <TH>Fleet</TH>}<TH>Status</TH><TH>Progress</TH><TH>Next stop</TH><TH>Finishes ≈</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD><Link className="font-medium text-primary hover:underline" href={`/admin/delivery/routes/${r.id}`}>{r.number}</Link></TD>
                  <TD>{r.driver}{r.phone ? <div className="text-xs text-muted-foreground">{r.phone}</div> : null}{r.vehicle ? <div className="text-xs text-muted-foreground">{r.vehicle}</div> : null}</TD>
                  {all && <TD>{r.executor}</TD>}
                  <TD><Badge variant={ST[r.status].v}>{ST[r.status].label}</Badge></TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-muted" role="img" aria-label={`${r.done} of ${r.total} stops done`}><div className="h-2 rounded-full bg-primary" style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} /></div>
                      <span className="tabular-nums text-xs">{r.done}/{r.total}</span>
                      {r.late > 0 && <Badge variant="destructive">{r.late} late</Badge>}
                    </div>
                  </TD>
                  <TD>{r.next ? <><span className="tabular-nums">{hm(r.next.eta)}</span> · {r.next.kind === "PICKUP" ? "Pickup" : "Delivery"} {r.next.label} <span className="text-xs text-muted-foreground">({r.next.order})</span></> : "—"}</TD>
                  <TD className="tabular-nums">{r.status === "COMPLETED" ? "Done" : hm(r.finishEta)}</TD>
                </TR>
              ))}
              {!rows.length && <EmptyRow colSpan={all ? 7 : 6}>No routes today.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
