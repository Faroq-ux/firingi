import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { DocumentQueue } from "@/components/admin/queues";

export const metadata = { title: "Vendor Documents" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return <DocumentQueue ctx={ctx} title="Vendor Documents" types={["DISTRIBUTOR", "WHOLESALER"]} />;
}
