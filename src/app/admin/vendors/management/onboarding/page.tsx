import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Vendor Onboarding" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Vendor Onboarding"
      basePath="/admin/vendors/management/onboarding"
      types={["DISTRIBUTOR", "WHOLESALER"]}
      defaultStatuses={["PENDING"]}
      columns={["type"]}
      params={await searchParams}
    />
  );
}
