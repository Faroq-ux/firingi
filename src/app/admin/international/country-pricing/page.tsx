import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PriceListsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Country Pricing" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.international.view"]);
  return <PriceListsView ctx={ctx} title="Country Pricing" />;
}
