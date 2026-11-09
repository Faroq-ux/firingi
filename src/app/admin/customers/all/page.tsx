import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "All Customers" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="All Customers"
      basePath="/admin/customers/all"
      types={["CUSTOMER"]}
      columns={["businessType"]}
      params={await searchParams}
    />
  );
}
