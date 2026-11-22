import { notFound } from "next/navigation";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getOrder } from "@/server/services/orders";
import { NotFoundError } from "@/server/errors";
import { OrderDetail } from "@/components/orders/order-views";
import { OrderDepositsCard } from "@/components/returnables/views";
import { OrderWeightsCard } from "@/components/catchweight/views";
import { OrderColdCard } from "@/components/coldchain/views";
import { OrderExciseCard } from "@/components/excise/views";
import { OrderSubstitutionsCard } from "@/components/substitutions/views";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const { id } = await params;
  const o = await getOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <><OrderDetail ctx={ctx} id={id} /><OrderSubstitutionsCard ctx={ctx} orderId={id} as="SUPPLIER" /><div id="weights"><OrderWeightsCard ctx={ctx} orderId={id} as="SUPPLIER" /></div><OrderColdCard ctx={ctx} orderId={id} as="SUPPLIER" /><OrderExciseCard ctx={ctx} orderId={id} as="SUPPLIER" /><OrderDepositsCard orderId={id} status={o.order.status} /></>;
}
