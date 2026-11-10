import { notFound } from "next/navigation";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { routeDetail } from "@/server/services/routes";
import { PageHeader } from "@/components/layout/page-header";
import { RouteDetail } from "@/components/routes/route-views";

export const metadata = { title: "Route" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage"]);
  const { id } = await params;
  const r = await routeDetail(ctx, id).catch(() => null);
  if (!r) notFound();
  const ex = r.route.executor;
  return (
    <>
      <PageHeader title={`Route ${r.route.number}`} description={`Fleet: ${ex.tradeName ?? ex.legalName}`} />
      <RouteDetail ctx={ctx} id={id} english deliveryHref={(orderId) => `/admin/orders/${orderId}`} />
    </>
  );
}
