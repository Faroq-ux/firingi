import type { DeliveryStatus } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listDeliveries } from "@/server/services/deliveries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryTable } from "@/components/delivery/delivery-views";

export const metadata = { title: "Live Deliveries" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const rows = await listDeliveries(ctx, { as: "ADMIN", statuses: ["PICKED_UP", "OUT_FOR_DELIVERY"] as DeliveryStatus[] });
  return (
    <>
      <PageHeader title="Live Deliveries" description="Orders on the road right now — FIRINGI fleet, vendor fleets and carriers." />
      <Card><CardContent className="pt-5"><DeliveryTable rows={rows} orderBase="/admin/orders" showExecutor /></CardContent></Card>
    </>
  );
}
