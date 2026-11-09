import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { VariantsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Product Variants" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  return <VariantsView ctx={ctx} title="Product Variants" q={(await searchParams).q} />;
}
