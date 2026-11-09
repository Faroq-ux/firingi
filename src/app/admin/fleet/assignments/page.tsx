import type { DeliveryStatus } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listDeliveries } from "@/server/services/deliveries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryTable } from "@/components/delivery/delivery-views";

export const metadata = { title: "Driver Assignments" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"]);
  const rows = await listDeliveries(ctx, { as: "DISPATCH", statuses: ["UNASSIGNED", "ASSIGNED", "FAILED"] as DeliveryStatus[] });
  return (
    <>
      <PageHeader title="Driver Assignments" description="FIRINGI-fleet deliveries to assign or reassign. Open an order to choose the driver and vehicle." />
      <Card><CardContent className="pt-5"><DeliveryTable rows={rows} orderBase="/admin/orders" showExecutor /></CardContent></Card>
    </>
  );
}
