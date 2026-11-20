import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RecipesView } from "@/components/kitchen/pages";

export const metadata = { title: "Recipes & Costing" };
export const dynamic = "force-dynamic";

/** Phase 54: menu costing & food waste. */
export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.kitchen.manage");
  return <RecipesView ctx={ctx} />;
}
