import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { VariantsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "SKU Management" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  return <VariantsView ctx={ctx} title="SKU Management" q={(await searchParams).q} />;
}
