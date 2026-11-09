import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SalesInvoicesView } from "@/components/finance/views";

export const metadata = { title: "Customer Invoices" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.invoices.view", "admin.finance.view"]);
  return <SalesInvoicesView ctx={ctx} as="ADMIN" title="Customer Invoices (FIRINGI sales)" docType="INVOICE" />;
}
