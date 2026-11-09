import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CommissionsView } from "@/components/finance/views";

export const metadata = { title: "Commission" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.commission", "admin.finance.view"]);
  return <CommissionsView ctx={ctx} />;
}
