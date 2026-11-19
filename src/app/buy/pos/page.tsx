import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosOverviewPage } from "@/components/pos/pages";

export const metadata = { title: "Till" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosOverviewPage ctx={ctx} portal="buy" />;
}
