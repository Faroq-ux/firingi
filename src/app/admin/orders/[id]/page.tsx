import { notFound } from "next/navigation";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getOrder } from "@/server/services/orders";
import { NotFoundError } from "@/server/errors";
import { OrderDetail } from "@/components/orders/order-views";
import { OrderDepositsCard } from "@/components/returnables/views";
import { OrderWeightsCard } from "@/components/catchweight/views";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  const { id } = await params;
  const o = await getOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <><OrderDetail ctx={ctx} id={id} /><div id="weights"><OrderWeightsCard ctx={ctx} orderId={id} as="ADMIN" english /></div><OrderDepositsCard orderId={id} status={o.order.status} english /></>;
}
