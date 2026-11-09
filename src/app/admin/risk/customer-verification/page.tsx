import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Customer Verification" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.risk.view", "admin.customers.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Customer Verification"
      basePath="/admin/risk/customer-verification"
      types={["CUSTOMER"]}
      defaultStatuses={["UNDER_REVIEW"]}
      columns={["businessType"]}
      params={await searchParams}
    />
  );
}
