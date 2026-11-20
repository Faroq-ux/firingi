import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SupplierRewardsView } from "@/components/rewards/pages";

export const metadata = { title: "Reward Products" };
export const dynamic = "force-dynamic";

/** Phase 55: the supplier's own products as rewards. */
export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.promotions.manage");
  return <SupplierRewardsView ctx={ctx} />;
}
