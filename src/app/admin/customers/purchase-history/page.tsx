import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OrderList } from "@/components/orders/order-views";

export const metadata = { title: "Purchase History" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  return <OrderList ctx={ctx} as="ADMIN" title="Purchase History" basePath="/admin/customers/purchase-history" sellerType="WHOLESALER" description={"Orders placed by wholesale customers."} params={await searchParams} />;
}
