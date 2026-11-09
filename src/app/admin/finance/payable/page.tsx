import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { BalancesView } from "@/components/finance/views";

export const metadata = { title: "Accounts Payable" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  return <BalancesView ctx={ctx} kind="payable" />;
}
