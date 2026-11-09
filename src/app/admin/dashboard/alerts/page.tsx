import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OrderList } from "@/components/orders/order-views";

export const metadata = { title: "Alerts & Exceptions" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.dashboard.view"]);
  return <OrderList ctx={ctx} as="ADMIN" title="Alerts & Exceptions" basePath="/admin/dashboard/alerts" description={"Orders with open exceptions."} withOpenExceptions params={await searchParams} />;
}
