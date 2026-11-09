import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Customer Applications" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Customer Applications"
      basePath="/admin/customers/applications"
      types={["CUSTOMER"]}
      defaultStatuses={["PENDING", "UNDER_REVIEW"]}
      columns={["businessType"]}
      params={await searchParams}
    />
  );
}
