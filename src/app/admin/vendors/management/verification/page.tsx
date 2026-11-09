import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Vendor Verification" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Vendor Verification"
      basePath="/admin/vendors/management/verification"
      types={["DISTRIBUTOR", "WHOLESALER"]}
      defaultStatuses={["UNDER_REVIEW"]}
      columns={["type", "vies"]}
      params={await searchParams}
    />
  );
}
