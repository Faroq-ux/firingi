import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyDashboard } from "@/components/layout/company-dashboard";

export const metadata = { title: "Dashboard" };

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.dashboard.view");
  return <CompanyDashboard ctx={ctx} portal="buy" />;
}
