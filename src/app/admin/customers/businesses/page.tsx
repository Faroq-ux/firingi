import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "Wholesale Businesses" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.approve"]);
  return (
    <CompanyList
      ctx={ctx}
      title="Wholesale Businesses"
      basePath="/admin/customers/businesses"
      types={["CUSTOMER"]}
      defaultStatuses={["APPROVED"]}
      columns={["businessType"]}
      params={await searchParams}
    />
  );
}
