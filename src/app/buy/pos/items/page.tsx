import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosItemsPage } from "@/components/pos/pages";

export const metadata = { title: "Till items" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosItemsPage ctx={ctx} portal="buy" edit={(await searchParams).edit} />;
}
