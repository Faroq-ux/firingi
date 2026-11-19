import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AdminAddressRequestsPage } from "@/components/admin/address-requests";

export const metadata = { title: "Address Approvals" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.approve", "admin.customers.view", "admin.settings.manage"]);
  return <AdminAddressRequestsPage ctx={ctx} types={["CUSTOMER"]} title="Customer Address Approvals" all={!!(await searchParams).all} />;
}
