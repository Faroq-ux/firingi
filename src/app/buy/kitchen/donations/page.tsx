import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { DonationsView } from "@/components/kitchen/pages";

export const metadata = { title: "Donations" };
export const dynamic = "force-dynamic";

/** Phase 54: menu costing & food waste. */
export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.kitchen.manage", "buyer.kitchen.waste"]);
  return <DonationsView ctx={ctx} />;
}
