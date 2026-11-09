import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Country-Specific Vendors" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.international.view"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Country-Specific Vendors" description="Filter by country with the country code (e.g. PT, ES, DE)."
      basePath="/admin/international/vendors"
      types={["DISTRIBUTOR", "WHOLESALER"]}
      columns={["type", "vies"]}
      params={await searchParams}
    />
  );
}
