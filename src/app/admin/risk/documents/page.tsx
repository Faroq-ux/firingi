import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { DocumentQueue } from "@/components/admin/queues";

export const metadata = { title: "Documents" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.risk.view", "admin.risk.manage"]);
  return <DocumentQueue ctx={ctx} title="Documents to review" types={["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"]} />;
}
