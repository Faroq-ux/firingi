import { Receipt } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listPlanInvoices, plansOverview } from "@/server/plans/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type Row } from "@/components/ui/data-table";
import { PlansTabs } from "@/components/plans/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Plan Invoices" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.commission", "admin.finance.view", "admin.finance.manage"]);
  const [rows, o] = await Promise.all([listPlanInvoices(ctx), plansOverview(ctx)]);
  return (
    <>
      <PageHeader title="Plan Invoices" icon={Receipt} description="FIRINGI's invoices for supplier plans: each month in advance, plus the difference when a supplier upgrades. Suppliers paying from payouts are settled automatically (Compensação)." />
      <PlansTabs active="/admin/vendors/plans/invoices" pending={o.pendingEarly} />
      <Card><CardContent className="pt-4">
        <DataTable tableId="admin.plans.invoices" testId="plan-invoices-table" empty="No plan invoices yet."
          columns={[{ key: "number", label: "Invoice" }, { key: "company", label: "Supplier", filter: true }, { key: "plan", label: "Plan", filter: true }, { key: "period", label: "Period" }, { key: "kind", label: "Kind", filter: true }, { key: "billing", label: "Paid by", filter: true }, { key: "gross", label: "Total", type: "number" }, { key: "open", label: "Open", type: "number" }]}
          rows={rows.map((r): Row => ({
            id: r.id, cells: { number: { t: r.number ?? "—", mono: true, node: <a className="font-mono text-primary hover:underline" href={`/api/invoices/${r.invoiceId}/pdf`} target="_blank" rel="noreferrer">{r.number ?? "—"}</a> },
            company: r.company, plan: r.plan.name, period: `${formatDate(r.periodStart, "en-GB")} – ${formatDate(r.periodEnd, "en-GB")}`, kind: r.kind === "UPGRADE" ? "Upgrade" : "Month",
            billing: r.billing === "PAYOUT" ? "From payouts" : "Invoice", gross: formatMoney(r.gross.toString(), "en-GB"), open: formatMoney(String(r.open), "en-GB"),
          } }))} />
      </CardContent></Card>
    </>
  );
}
