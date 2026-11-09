import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PriceListsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Product Pricing" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve", "admin.pricing.view", "admin.pricing.manage"]);
  return <PriceListsView ctx={ctx} title="Product Pricing" />;
}
