import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PriceListsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Price Lists" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  return <PriceListsView ctx={ctx} title="Price Lists" />;
}
