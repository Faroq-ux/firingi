import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Distributor Applications" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Distributor Applications"
      basePath="/admin/vendors/distributors/applications"
      types={["DISTRIBUTOR"]}
      defaultStatuses={["PENDING", "UNDER_REVIEW"]}
      columns={["vies"]}
      params={await searchParams}
    />
  );
}
