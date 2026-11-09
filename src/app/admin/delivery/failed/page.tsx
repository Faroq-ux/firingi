import type { DeliveryStatus } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listDeliveries } from "@/server/services/deliveries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryTable } from "@/components/delivery/delivery-views";

export const metadata = { title: "Failed Deliveries" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const rows = await listDeliveries(ctx, { as: "ADMIN", statuses: ["FAILED"] as DeliveryStatus[] });
  return (
    <>
      <PageHeader title="Failed Deliveries" description="Failed attempts waiting for a decision: assign a driver to retry, or return the goods to the supplier (open the order)." />
      <Card><CardContent className="pt-5"><DeliveryTable rows={rows} orderBase="/admin/orders" showExecutor /></CardContent></Card>
    </>
  );
}
