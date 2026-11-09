import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Distributors" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Distributors"
      basePath="/admin/vendors/distributors/all"
      types={["DISTRIBUTOR"]}
      columns={["vies", "commission"]}
      params={await searchParams}
    />
  );
}
