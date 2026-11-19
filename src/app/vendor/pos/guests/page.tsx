import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosGuestsPage } from "@/components/pos/pages";

export const metadata = { title: "Guests & loyalty" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosGuestsPage ctx={ctx} q={(await searchParams).q} />;
}
