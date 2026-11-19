import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PosShiftsPage } from "@/components/pos/pages";

export const metadata = { title: "Shifts" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.pos.sell", "company.pos.manage"]);
  return <PosShiftsPage ctx={ctx} />;
}
