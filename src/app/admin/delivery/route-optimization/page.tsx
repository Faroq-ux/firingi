import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { depotOptions, routingSettings } from "@/server/services/routes";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoutesList } from "@/components/routes/route-views";
import { RoutingSettingsForm } from "@/components/routes/route-forms";

export const metadata = { title: "Route Optimization" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const [values, depots] = await Promise.all([routingSettings(), depotOptions(ctx)]);
  return (
    <>
      <PageHeader title="Route Optimization" description="How stops are ordered and timed. Every route starts at the depot, collects at each supplier before delivering that supplier's order, and visits the stops in the shortest order found (nearest stop first, then every stop is tried in every position)." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader><CardTitle>Planning settings</CardTitle></CardHeader>
          <CardContent><RoutingSettingsForm values={values} depots={depots} canEdit={can(ctx, "admin.delivery.manage")} only={["plan"]} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Open routes</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Open a route to re-optimise it (stops already done stay where they are) or to move stops by hand. Distances are straight-line × road factor; times use the average speed plus the time per stop.</p>
            <RoutesList ctx={ctx} english base="/admin/delivery/routes" tab="open" all />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
