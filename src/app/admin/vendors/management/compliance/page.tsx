import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { VendorComplianceList } from "@/components/admin/queues";

export const metadata = { title: "Vendor Compliance" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view"]);
  return <VendorComplianceList ctx={ctx} />;
}
