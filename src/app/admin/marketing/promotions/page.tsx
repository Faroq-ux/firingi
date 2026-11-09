import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PromotionsView } from "@/components/finance/views";
import { PromotionForm } from "@/components/finance/controls";
import { adminPromotionOptions } from "@/server/data/catalogue-admin";
import { can } from "@/server/rbac/guard";

export const metadata = { title: "Promotions" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.marketing.view", "admin.marketing.manage", "admin.catalogue.view"]);
  const opts = await adminPromotionOptions(ctx);
  return <PromotionsView ctx={ctx} as="ADMIN" title="Promotions" form={can(ctx, ["admin.pricing.manage", "admin.marketing.manage"]) ? <PromotionForm mode="ADMIN" {...opts} /> : null} />;
}
