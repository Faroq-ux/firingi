import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { WasteReportsView } from "@/components/kitchen/pages";

export const metadata = { title: "Waste Reports" };
export const dynamic = "force-dynamic";

/** Phase 54: menu costing & food waste. */
export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.kitchen.manage");
  return <WasteReportsView ctx={ctx} days={[7, 30, 90].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30} />;
}
