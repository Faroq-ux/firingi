import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SalesInvoicesView } from "@/components/finance/views";

export const metadata = { title: "Credit Notes" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  return <SalesInvoicesView page={Number((await searchParams).page) || 1} basePath="/admin/finance/credit-notes" ctx={ctx} as="ADMIN" title="Credit Notes" docType="CREDIT_NOTE" />;
}
