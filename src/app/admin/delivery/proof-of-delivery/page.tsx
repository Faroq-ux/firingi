import type { DeliveryStatus } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listDeliveries } from "@/server/services/deliveries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeliveryTable } from "@/components/delivery/delivery-views";

export const metadata = { title: "Proof of Delivery" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const rows = await listDeliveries(ctx, { as: "ADMIN", withProof: true, take: 300 });
  return (
    <>
      <PageHeader title="Proof of Delivery" description="Delivered orders with the recipient's name, signature, photos and location. Open an order to see the proof." />
      <Card><CardContent className="pt-5"><DeliveryTable rows={rows} orderBase="/admin/orders" showExecutor /></CardContent></Card>
    </>
  );
}
