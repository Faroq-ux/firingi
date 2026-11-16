import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listAdInvoices } from "@/server/ads/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { AdsTabs, InvoiceNowButton } from "@/components/ads/admin";
import { BILLING_LABEL } from "@/components/ads/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Ad invoices" };
export const dynamic = "force-dynamic";

export default async function AdInvoices() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.finance.view", "admin.finance.manage"]);
  const rows = await listAdInvoices(ctx);
  return (
    <>
      <PageHeader title="Ad invoices" icon={Megaphone} actions={ctx.permissions.has("admin.finance.manage") ? <InvoiceNowButton /> : undefined}
        description="FIRINGI's invoices to suppliers for advertising: one per supplier each month (issued automatically on the 1st for the month before), and an invoice-receipt for every prepaid transfer. Suppliers in a country without a FIRINGI entity are invoiced under the EU reverse charge." />
      <AdsTabs active="/admin/marketing/ads/invoices" />
      <DataTable tableId="admin.ads.invoices" testId="ad-invoices-table" empty="No ad invoices yet."
        columns={[{ key: "number", label: "Invoice" }, { key: "date", label: "Date", type: "date" }, { key: "supplier", label: "Supplier", filter: true }, { key: "kind", label: "For", filter: true }, { key: "billing", label: "Collected by", filter: true }, { key: "gross", label: "Total", type: "number" }, { key: "open", label: "Open", type: "number" }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/admin/invoices/${r.id}`,
          cells: {
            number: { t: r.number ?? "—", mono: true, href: `/admin/invoices/${r.id}`, sub: r.reverseCharge ? "reverse charge" : undefined }, date: r.issuedAt.toISOString().slice(0, 10), supplier: r.company,
            kind: r.kind === "TOPUP" ? "Prepaid top-up" : "Month's ads", billing: BILLING_LABEL[r.billing],
            gross: { t: formatMoney(r.gross, "en-GB"), v: Number(r.gross) }, open: { t: formatMoney(r.open, "en-GB"), v: Number(r.open), tone: Number(r.open) > 0 ? "warning" : undefined },
          },
        }))} />
    </>
  );
}
