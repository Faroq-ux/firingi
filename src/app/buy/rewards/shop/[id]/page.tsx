import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RewardDetailView } from "@/components/rewards/pages";

export const metadata = { title: "Reward" };
export const dynamic = "force-dynamic";

/** Phase 55: one reward — redeem it, save for it. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const { id } = await params;
  return <RewardDetailView ctx={ctx} id={id} />;
}
