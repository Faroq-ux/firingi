import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosSettingsPage } from "@/components/pos/pages";

export const metadata = { title: "Till settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.pos.manage"]);
  return <PosSettingsPage ctx={ctx} portal="vendor" />;
}
