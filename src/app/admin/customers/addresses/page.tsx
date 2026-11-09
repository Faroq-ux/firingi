import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CustomerAddressList } from "@/components/admin/queues";

export const metadata = { title: "Customer Addresses" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.approve"]);
  return <CustomerAddressList ctx={ctx} />;
}
