import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OffersView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Stock" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  return <OffersView ctx={ctx} title="Stock" basePath="/admin/catalogue/stock" params={await searchParams} showStock description="Stock per offer across all vendor warehouses." />;
}
