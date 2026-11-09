import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CustomerGroupsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Customer Groups" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.manage", "admin.pricing.view"]);
  return <CustomerGroupsView ctx={ctx} />;
}
