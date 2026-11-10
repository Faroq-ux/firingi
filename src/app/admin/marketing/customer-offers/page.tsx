import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OffersView } from "@/components/marketing/offers-view";

export const metadata = { title: "Customer Offers" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.pricing.view", "admin.pricing.manage"]);
  return <OffersView ctx={ctx} kind="OFFERS" />;
}
