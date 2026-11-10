import { notFound } from "next/navigation";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { routeDetail } from "@/server/services/routes";
import { PageHeader } from "@/components/layout/page-header";
import { RouteDetail, routeLabels } from "@/components/routes/route-views";

export const metadata = { title: "Route" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.manage", "vendor.drivers.manage", "vendor.orders.view", "vendor.fleet.view"]);
  const { id } = await params;
  const r = await routeDetail(ctx, id).catch(() => null);
  if (!r) notFound();
  const { l } = await routeLabels(false);
  return (
    <>
      <PageHeader title={`${l.number} ${r.route.number}`} />
      <RouteDetail ctx={ctx} id={id} english={false} deliveryHref={(orderId) => `/vendor/orders/${orderId}`} />
    </>
  );
}
