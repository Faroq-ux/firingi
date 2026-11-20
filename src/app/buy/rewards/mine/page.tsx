import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { MyRewardsView } from "@/components/rewards/pages";

export const metadata = { title: "My Rewards" };
export const dynamic = "force-dynamic";

/** Phase 55: what the business redeemed. */
export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  return <MyRewardsView ctx={ctx} />;
}
