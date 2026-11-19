import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { EInvoicingPortalPage } from "@/components/einvoice/portal-page";

export const metadata = { title: "E-Invoicing" };
export const dynamic = "force-dynamic";

export default async function VendorEInvoicingPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.profile.manage", "company.accounting.manage", "vendor.invoices.view", "vendor.invoices.submit"]);
  return <EInvoicingPortalPage ctx={ctx} vendor />;
}
