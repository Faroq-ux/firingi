import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listAdvertisers } from "@/server/ads/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { AdsTabs, BillingSelect, TopUpForm } from "@/components/ads/admin";
import { BILLING_LABEL } from "@/components/ads/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Advertisers & billing" };
export const dynamic = "force-dynamic";

export default async function Advertisers() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.finance.view", "admin.finance.manage"]);
  const rows = await listAdvertisers(ctx);
  const billing = ctx.permissions.has("admin.finance.manage") || ctx.permissions.has("admin.marketing.manage");
  const finance = ctx.permissions.has("admin.finance.manage");
  return (
    <>
      <PageHeader title="Advertisers & billing" icon={Megaphone}
        description="How FIRINGI collects from each supplier, as agreed with them: deducted from payouts (the monthly ad invoice is settled against what FIRINGI owes them), prepaid balance (record each transfer here — an invoice-receipt is issued and the net amount added) or monthly invoice (paid with normal terms). A remaining prepaid balance is always used first." />
      <AdsTabs active="/admin/marketing/ads/advertisers" />
      <DataTable tableId="admin.ads.advertisers" testId="advertisers-table" empty="No suppliers."
        columns={[{ key: "supplier", label: "Supplier" }, { key: "type", label: "Type", filter: true }, { key: "country", label: "Country", filter: true }, { key: "billing", label: "How FIRINGI collects" }, { key: "balance", label: "Prepaid balance", type: "number" }, { key: "spend", label: "Spent this month", type: "number" }, { key: "open", label: "Ad invoices open", type: "number" }, { key: "active", label: "Running", type: "number" }, { key: "topup", label: "Prepaid transfer received" }]}
        rows={rows.map((r) => ({
          id: r.id,
          cells: {
            supplier: r.name, type: r.type === "WHOLESALER" ? "Wholesaler" : "Distributor", country: r.country,
            billing: billing ? { t: BILLING_LABEL[r.billing], node: <BillingSelect companyId={r.id} billing={r.billing} name={r.name} /> } : BILLING_LABEL[r.billing],
            balance: { t: formatMoney(r.balance, "en-GB"), v: Number(r.balance) }, spend: { t: formatMoney(r.spendMonth, "en-GB"), v: Number(r.spendMonth) },
            open: { t: formatMoney(r.open, "en-GB"), v: Number(r.open) }, active: r.active,
            topup: finance ? { t: "", node: <TopUpForm companyId={r.id} name={r.name} /> } : "",
          },
        }))} />
    </>
  );
}
