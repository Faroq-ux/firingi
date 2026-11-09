import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OffersView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Vendor Products" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  return <OffersView ctx={ctx} title="Vendor Products" basePath="/admin/catalogue/vendor-products" params={await searchParams} description="All vendor offers on the master catalogue." />;
}
