import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CompanyList } from "@/components/admin/company-list";

export const metadata = { title: "KYC / KYB — open applications" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.risk.view"]);
  return (
    <CompanyList
      ctx={ctx}
      title="KYC / KYB — open applications"
      basePath="/admin/risk/kyc"
      types={["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"]}
      defaultStatuses={["PENDING", "UNDER_REVIEW"]}
      columns={["type", "vies"]}
      params={await searchParams}
    />
  );
}
