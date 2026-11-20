import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RecipeView } from "@/components/kitchen/pages";

export const metadata = { title: "Recipe" };
export const dynamic = "force-dynamic";

/** Phase 54: menu costing & food waste. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.kitchen.manage");
  return <RecipeView ctx={ctx} id={(await params).id} />;
}
