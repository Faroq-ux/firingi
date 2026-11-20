import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ShopView } from "@/components/rewards/pages";

export const metadata = { title: "Rewards Shop" };
export const dynamic = "force-dynamic";

/** Phase 55: the rewards shop. */
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const { kind } = await searchParams;
  return <ShopView ctx={ctx} kind={kind && /^[A-Z_]{3,20}$/.test(kind) ? kind : undefined} />;
}
