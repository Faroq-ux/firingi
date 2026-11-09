import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Active Wholesalers" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Active Wholesalers"
      basePath="/admin/vendors/wholesalers/active"
      types={["WHOLESALER"]}
      defaultStatuses={["APPROVED"]}
      columns={["commission"]}
      params={await searchParams}
    />
  );
}
