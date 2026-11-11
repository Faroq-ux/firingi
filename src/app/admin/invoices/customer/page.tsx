import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SalesInvoicesView } from "@/components/finance/views";

export const metadata = { title: "Customer Invoices" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.invoices.view", "admin.finance.view"]);
  return <SalesInvoicesView page={Number((await searchParams).page) || 1} basePath="/admin/invoices/customer" ctx={ctx} as="ADMIN" title="Customer Invoices (FIRINGI sales)" docType="INVOICE" />;
}
