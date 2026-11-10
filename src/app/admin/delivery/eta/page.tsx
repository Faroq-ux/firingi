import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { depotOptions, openEtas, routingSettings } from "@/server/services/routes";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { hm } from "@/components/routes/route-views";
import { RoutingSettingsForm } from "@/components/routes/route-forms";

export const metadata = { title: "ETA Management" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const [values, depots, rows] = await Promise.all([routingSettings(), depotOptions(ctx), openEtas(ctx, true)]);
  const half = values.etaWindowMinutes / 2;
  return (
    <>
      <PageHeader title="ETA Management" description="Every stop gets an expected time when the route is planned. When the driver starts, customers are told their window; each pickup and delivery moves the times of the stops after it." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>Customer window</CardTitle></CardHeader>
          <CardContent><RoutingSettingsForm values={values} depots={depots} canEdit={can(ctx, "admin.delivery.manage")} only={["eta"]} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Deliveries on open routes ({rows.length})</CardTitle></CardHeader>
          <CardContent>
            <Table data-testid="eta-table">
              <THead><TR><TH>Order</TH><TH>Customer</TH><TH>Route</TH><TH>Planned</TH><TH>Now expected</TH><TH>Window</TH><TH /></TR></THead>
              <TBody>
                {rows.map((r) => {
                  const late = r.delayMin !== null && r.delayMin > half;
                  return (
                    <TR key={r.id}>
                      <TD><Link className="text-primary hover:underline" href={`/admin/orders/${r.order.id}`}>{r.order.number}</Link></TD>
                      <TD>{r.customer}<div className="text-xs text-muted-foreground">{r.address}</div></TD>
                      <TD><Link className="hover:underline" href={`/admin/delivery/routes/${r.route.id}`}>{r.route.number}</Link><div className="text-xs text-muted-foreground">{r.route.driver?.user.name ?? "—"}</div></TD>
                      <TD className="tabular-nums">{hm(r.planned)}</TD>
                      <TD className="tabular-nums">{hm(r.eta)}{r.delayMin ? <span className="ml-1 text-xs text-muted-foreground">({r.delayMin > 0 ? "+" : ""}{r.delayMin} min)</span> : null}</TD>
                      <TD className="tabular-nums">{r.eta ? `${hm(new Date(r.eta.getTime() - half * 60_000))}–${hm(new Date(r.eta.getTime() + half * 60_000))}` : "—"}</TD>
                      <TD>{late ? <Badge variant="destructive">Late</Badge> : <Badge variant="success">On time</Badge>}</TD>
                    </TR>
                  );
                })}
                {!rows.length && <EmptyRow colSpan={7}>No deliveries on open routes.</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
