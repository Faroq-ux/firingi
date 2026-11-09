import { notFound } from "next/navigation";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getOrder } from "@/server/services/orders";
import { NotFoundError } from "@/server/errors";
import { OrderDetail } from "@/components/orders/order-views";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const { id } = await params;
  await getOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <OrderDetail ctx={ctx} id={id} />;
}
