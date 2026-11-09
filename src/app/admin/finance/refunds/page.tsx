import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SalesInvoicesView } from "@/components/finance/views";

export const metadata = { title: "Refunds" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  return <SalesInvoicesView ctx={ctx} as="ADMIN" title="Refunds (credit notes)" docType="CREDIT_NOTE" />;
}
