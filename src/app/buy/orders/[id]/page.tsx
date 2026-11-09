import { notFound } from "next/navigation";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getOrder } from "@/server/services/orders";
import { NotFoundError } from "@/server/errors";
import { OrderDetail } from "@/components/orders/order-views";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const { id } = await params;
  await getOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <OrderDetail ctx={ctx} id={id} placed={(await searchParams).placed === "1"} />;
}
