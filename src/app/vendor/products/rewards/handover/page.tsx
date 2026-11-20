import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SupplierHandoverView } from "@/components/rewards/pages";

export const metadata = { title: "Rewards to Hand Over" };
export const dynamic = "force-dynamic";

/** Phase 55: customers who redeemed the supplier's products. */
export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.promotions.manage");
  return <SupplierHandoverView ctx={ctx} />;
}
