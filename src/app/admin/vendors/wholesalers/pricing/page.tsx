import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PriceListsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Wholesaler Pricing" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.pricing.view", "admin.pricing.manage"]);
  return <PriceListsView ctx={ctx} title="Wholesaler Pricing" sellerType="WHOLESALER" />;
}
