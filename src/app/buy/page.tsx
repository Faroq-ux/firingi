import { redirect } from "next/navigation";
import { pagePortal } from "@/server/rbac/guard";
import { can } from "@/server/rbac/guard";
import { findFirstAllowed } from "@/config/nav/first-allowed";

export default async function BuyIndex() {
  const ctx = await pagePortal("buy");
  // Land on the dashboard, or the first page this user may open.
  redirect(can(ctx, "buyer.dashboard.view") ? "/buy/dashboard/overview" : findFirstAllowed("buy", ctx.permissions));
}
