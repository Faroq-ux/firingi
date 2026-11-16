import { Crown } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listPlans, listSubscribers, plansOverview } from "@/server/plans/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type Row } from "@/components/ui/data-table";
import { PlansTabs, SubscriberControls } from "@/components/plans/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Supplier Plans — Suppliers" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.commission", "admin.finance.view", "admin.finance.manage"]);
  const [rows, plans, o] = await Promise.all([listSubscribers(ctx), listPlans(), plansOverview(ctx)]);
  const manage = ctx.permissions.has("admin.vendors.commission") || ctx.permissions.has("admin.settings.manage");
  return (
    <>
      <PageHeader title="Supplier Plans" icon={Crown} description="Each supplier's plan, trial and how it pays. Set a plan now or from the next period, add trial days, keep a supplier's own commission, switch early payout off or give it its own limit." />
      <PlansTabs active="/admin/vendors/plans/subscribers" pending={o.pendingEarly} />
      {!o.settings.enabled && <p className="mb-3 rounded-md bg-warning/15 p-3 text-sm">Plans are off — suppliers get a subscription (free trial) once you switch them on.</p>}
      <Card><CardContent className="pt-4">
        <DataTable tableId="admin.plans.subscribers" testId="subscribers" empty="No approved suppliers."
          columns={[{ key: "supplier", label: "Supplier" }, { key: "type", label: "Type", filter: true }, { key: "plan", label: "Plan", filter: true }, { key: "status", label: "Status", type: "badge", filter: true }, { key: "until", label: "Trial ends / renews" }, { key: "commission", label: "Commission", type: "number" }, { key: "controls", label: "Change" }]}
          rows={rows.map((r): Row => ({
            id: r.id, cells: { supplier: r.name, type: r.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler",
            plan: r.sub ? `${r.sub.plan.name}${r.sub.pending ? ` → ${r.sub.pending.name}` : ""}` : "—",
            status: r.sub ? { t: r.sub.status === "TRIAL" ? "Trial" : r.sub.status === "ACTIVE" ? "Active" : "Cancelled", tone: r.sub.status === "TRIAL" ? "warning" : "success" } : "—",
            until: r.sub ? formatDate((r.sub.status === "TRIAL" ? r.sub.trialEndsAt : r.sub.periodEnd) ?? new Date(), "en-GB") : "—",
            commission: r.commission === null ? "—" : `${r.commission} %${r.sub?.commissionLocked ? " (own)" : ""}`,
            controls: r.sub && manage ? { t: r.sub.plan.name, node: <SubscriberControls companyId={r.id} name={r.name} plans={plans.map((p) => ({ id: p.id, name: p.name }))} planId={r.sub.planId} status={r.sub.status} billing={r.sub.billing} commissionLocked={r.sub.commissionLocked} earlyPayEnabled={r.sub.earlyPayEnabled} earlyPayLimit={r.sub.earlyPayLimit === null ? null : Number(r.sub.earlyPayLimit)} /> } : "—",
          } }))} />
      </CardContent></Card>
    </>
  );
}
