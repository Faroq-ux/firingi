import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { EngineeringView } from "@/components/kitchen/pages";

export const metadata = { title: "Menu Engineering" };
export const dynamic = "force-dynamic";

/** Phase 54: menu costing & food waste. */
export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.kitchen.manage");
  return <EngineeringView ctx={ctx} days={Number((await searchParams).days) || undefined} />;
}
