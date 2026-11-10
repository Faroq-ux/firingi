import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { ordersPerDriver } from "@/server/services/delivery-settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanPanel, RoutesList } from "@/components/routes/route-views";

export const metadata = { title: "Multi-Stop Routes" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const manage = can(ctx, "admin.delivery.manage");
  const limit = await ordersPerDriver(ctx.company.id, true);
  return (
    <>
      <PageHeader title="Multi-Stop Routes"
        description={`Small orders FIRINGI's fleet delivers, grouped onto drivers' routes. Up to ${limit} order${limit === 1 ? "" : "s"} per driver (Delivery Settings → multi-order delivery). "Plan the day automatically" splits the waiting deliveries by direction over the free drivers, longest-waiting first.`} />
      <div className="space-y-4">
        {manage ? <PlanPanel ctx={ctx} english routeBase="/admin/delivery/routes" /> : <p className="text-sm text-muted-foreground">You can view routes; planning needs the delivery-management permission.</p>}
        <Card>
          <CardHeader><CardTitle>Open routes</CardTitle></CardHeader>
          <CardContent><RoutesList ctx={ctx} english base="/admin/delivery/routes" tab="open" /></CardContent>
        </Card>
      </div>
    </>
  );
}
