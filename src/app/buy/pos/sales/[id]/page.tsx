import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosSaleDetailPage } from "@/components/pos/pages";

export const metadata = { title: "Till receipt" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosSaleDetailPage ctx={ctx} portal="buy" id={(await params).id} />;
}
