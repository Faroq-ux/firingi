import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosStockPage } from "@/components/pos/pages";

export const metadata = { title: "Ingredient stock" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["company.pos.manage"]);
  return <PosStockPage ctx={ctx} />;
}
