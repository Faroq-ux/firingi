import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RestrictionQueue } from "@/components/admin/queues";

export const metadata = { title: "Tobacco & Alcohol Compliance" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.risk.view", "admin.risk.manage", "admin.customers.approve"]);
  return <RestrictionQueue ctx={ctx} title="Tobacco & Alcohol Access" />;
}
