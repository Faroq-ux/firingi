import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { VendorInvoicesView } from "@/components/finance/views";

export const metadata = { title: "Distributor Invoices" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.invoices.view", "admin.finance.view"]);
  return <VendorInvoicesView ctx={ctx} as="ADMIN" title="Distributor Invoices" vendorType="DISTRIBUTOR" />;
}
