import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Wholesaler Applications" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Wholesaler Applications"
      basePath="/admin/vendors/wholesalers/applications"
      types={["WHOLESALER"]}
      defaultStatuses={["PENDING", "UNDER_REVIEW"]}
      columns={["commission"]}
      params={await searchParams}
    />
  );
}
