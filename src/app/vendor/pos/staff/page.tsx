import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosStaffPage } from "@/components/pos/pages";

export const metadata = { title: "Till staff" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosStaffPage ctx={ctx} />;
}
