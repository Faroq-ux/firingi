import { redirect } from "next/navigation";
import { pagePortal } from "@/server/rbac/guard";
import { can } from "@/server/rbac/guard";
import { findFirstAllowed } from "@/config/nav/first-allowed";

export default async function VendorIndex() {
  const ctx = await pagePortal("vendor");
  // Land on the dashboard, or the first page this user may open.
  redirect(can(ctx, "vendor.dashboard.view") ? "/vendor/dashboard/overview" : findFirstAllowed("vendor", ctx.permissions));
}
