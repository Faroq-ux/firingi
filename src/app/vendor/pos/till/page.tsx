import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosTillPage } from "@/components/pos/pages";

export const metadata = { title: "Till" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ register?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosTillPage ctx={ctx} portal="vendor" registerId={(await searchParams).register} />;
}
