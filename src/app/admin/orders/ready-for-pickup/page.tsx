import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OrderList } from "@/components/orders/order-views";

export const metadata = { title: "Ready for Pickup" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage"]);
  return <OrderList ctx={ctx} as="ADMIN" title="Ready for Pickup" basePath="/admin/orders/ready-for-pickup" statuses={["READY_FOR_PICKUP"]} params={await searchParams} />;
}
