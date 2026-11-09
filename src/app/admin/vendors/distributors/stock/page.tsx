import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OffersView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Distributor Stock" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return <OffersView ctx={ctx} title="Distributor Stock" basePath="/admin/vendors/distributors/stock" params={await searchParams} sellerType="DISTRIBUTOR" showStock />;
}
