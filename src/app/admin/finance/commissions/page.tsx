import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CommissionsView } from "@/components/finance/views";

export const metadata = { title: "Commissions" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.vendors.commission"]);
  return <CommissionsView ctx={ctx} />;
}
