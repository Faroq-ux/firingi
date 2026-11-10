import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ContractsView } from "@/components/profit/contracts-view";

export const metadata = { title: "Wholesaler Contracts" };

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.vendors.view"]);
  const s = (await searchParams).status;
  return <ContractsView ctx={ctx} vendorType={"WHOLESALER"} status={["ACTIVE", "EXPIRING", "EXPIRED"].includes(s ?? "") ? s! : "ALL"} title="Wholesaler Contracts" />;
}
