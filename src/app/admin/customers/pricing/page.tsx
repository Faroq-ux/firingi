import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PriceListsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Customer Pricing" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.manage", "admin.pricing.view", "admin.pricing.manage"]);
  return <PriceListsView ctx={ctx} title="Customer Pricing" scopes={["CUSTOMER", "CONTRACT", "CUSTOMER_GROUP"]} />;
}
