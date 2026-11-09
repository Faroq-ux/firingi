import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OrderList } from "@/components/orders/order-views";

export const metadata = { title: "Today's Activity" };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };


export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.dashboard.view"]);
  return <OrderList ctx={ctx} as="ADMIN" title="Today's Activity" basePath="/admin/dashboard/today" description={"Orders placed today."} since={startOfToday()} params={await searchParams} />;
}
