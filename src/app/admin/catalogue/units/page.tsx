import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { UnitsView } from "@/components/admin/catalogue-views";

export const metadata = { title: "Units & Packaging" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve"]);
  return <UnitsView ctx={ctx} />;
}
