import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosReportsPage } from "@/components/pos/pages";

export const metadata = { title: "Till reports" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; register?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosReportsPage ctx={ctx} sp={await searchParams} />;
}
