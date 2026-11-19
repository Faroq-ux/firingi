import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { EInvoicingPortalPage } from "@/components/einvoice/portal-page";

export const metadata = { title: "E-Invoicing" };
export const dynamic = "force-dynamic";

export default async function BuyerEInvoicingPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["company.profile.manage", "company.accounting.manage", "buyer.invoices.view"]);
  return <EInvoicingPortalPage ctx={ctx} vendor={false} />;
}
