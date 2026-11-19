import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosSalesPage } from "@/components/pos/pages";

export const metadata = { title: "Till sales" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string; fiscal?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosSalesPage ctx={ctx} portal="vendor" sp={await searchParams} />;
}
