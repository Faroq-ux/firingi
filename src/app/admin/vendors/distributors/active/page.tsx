import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Active Distributors" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Active Distributors"
      basePath="/admin/vendors/distributors/active"
      types={["DISTRIBUTOR"]}
      defaultStatuses={["APPROVED"]}
      columns={["vies", "commission"]}
      params={await searchParams}
    />
  );
}
