import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OffersView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Distributor Products" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve"]);
  return <OffersView ctx={ctx} title="Distributor Products" basePath="/admin/vendors/distributors/products" params={await searchParams} sellerType="DISTRIBUTOR" />;
}
