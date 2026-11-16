import { Crown } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { plansOverview } from "@/server/plans/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanEditor, PlansSettingsForm, PlansTabs, RunPlansButton, type PlanRow } from "@/components/plans/admin";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Supplier Plans" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.commission", "admin.finance.view", "admin.finance.manage"]);
  const o = await plansOverview(ctx);
  const manage = ctx.permissions.has("admin.vendors.commission") || ctx.permissions.has("admin.settings.manage");
  const kpis: [string, string, string][] = [
    ["Monthly plan revenue (MRR, excl. VAT)", formatMoney(String(o.mrr), "en-GB"), "kpi-mrr"],
    ["Plans invoiced this month", formatMoney(String(o.invoicedMonth), "en-GB"), "kpi-invoiced"],
    ["Trials ending within 14 days", String(o.trialsEnding), "kpi-trials"],
    ["Paid early this month", `${formatMoney(String(o.earlyPaidMonth), "en-GB")} · fees ${formatMoney(String(o.earlyFeesMonth), "en-GB")}`, "kpi-early"],
  ];
  const rows: PlanRow[] = o.plans.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description, monthlyPrice: Number(p.monthlyPrice), commissionPct: p.commissionPct === null ? null : Number(p.commissionPct), features: p.features,
    maxProducts: p.maxProducts, maxUsers: p.maxUsers, maxWarehouses: p.maxWarehouses, maxDrivers: p.maxDrivers, earlyPayModel: p.earlyPayModel as PlanRow["earlyPayModel"], earlyPayRate: Number(p.earlyPayRate),
    earlyPayMinFee: Number(p.earlyPayMinFee), freeEarlyPays: p.freeEarlyPays, active: p.active, sortOrder: p.sortOrder,
  }));
  return (
    <>
      <PageHeader title="Supplier Plans" icon={Crown} actions={manage ? <RunPlansButton /> : undefined}
        description="Monthly plans for suppliers: which ERP features they unlock, limits, commission on sales and early-payout terms. Switching plans on starts a free trial for every supplier; paid plans are invoiced monthly (deducted from payouts or by invoice). A plan's commission change needs a second person." />
      <PlansTabs active="/admin/vendors/plans" pending={o.pendingEarly} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="plans-kpis">
        {kpis.map(([label, value, id]) => <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="kpi-value text-xl font-semibold tabular-nums" data-testid={id}>{value}</p></CardContent></Card>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3" data-testid="plans-counts">
        {o.byPlan.map((p) => <Card key={p.id}><CardContent className="pt-5 text-sm"><p className="font-medium">{p.name}</p><p className="text-muted-foreground">{p.active} paying or active · {p.trial} on trial</p></CardContent></Card>)}
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
        <CardContent><PlansSettingsForm settings={o.settings} plans={o.plans.map((p) => ({ code: p.code, name: p.name }))} canManage={manage} /></CardContent>
      </Card>
      {rows.map((p) => (
        <Card key={p.id} className="mt-4">
          <CardHeader><CardTitle>{p.name} <span className="font-mono text-sm text-muted-foreground">{p.code}</span>{!p.active && <span className="ml-2 text-sm text-muted-foreground">(not offered)</span>}</CardTitle></CardHeader>
          <CardContent><PlanEditor plan={p} canManage={manage} /></CardContent>
        </Card>
      ))}
      {manage && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Add a plan</CardTitle></CardHeader>
          <CardContent><PlanEditor plan={null} canManage={manage} /></CardContent>
        </Card>
      )}
    </>
  );
}
