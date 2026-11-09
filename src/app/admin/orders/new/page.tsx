import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OrderList } from "@/components/orders/order-views";

export const metadata = { title: "New Orders" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  return <OrderList ctx={ctx} as="ADMIN" title="New Orders" basePath="/admin/orders/new" statuses={["NEW"]} params={await searchParams} />;
}
