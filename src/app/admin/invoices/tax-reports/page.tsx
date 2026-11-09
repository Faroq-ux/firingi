import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { VatView } from "@/components/finance/views";

export const metadata = { title: "VAT" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.invoices.view", "admin.finance.view", "admin.tax.manage"]);
  return <VatView ctx={ctx} month={(await searchParams).month} />;
}
