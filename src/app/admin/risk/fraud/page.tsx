import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { riskOverview, riskSettings } from "@/server/risk/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { BarList, ChartCard } from "@/components/analytics/charts";
import { RiskSettingsForm } from "@/components/risk/forms";

export const metadata = { title: "Fraud Detection" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.risk.view", "admin.risk.manage"]);
  const [o, settings] = await Promise.all([riskOverview(ctx, 30), riskSettings()]);
  return (
    <>
      <PageHeader title="Fraud Detection" description="Every checkout is scored by FIRINGI's risk checks; the points add up. From the hold score an order waits for review before the supplier sees it; from the review score it goes through and is reviewed afterwards. Last 30 days." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="risk-kpis">
        <Kpi label="Orders checked with points" value={o.checks} fmt="number" locale="en" index={0} />
        <Kpi label="Held" value={o.held} fmt="number" locale="en" hint={`worth ${new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(o.heldValue)}`} index={1} />
        <Kpi label="Flagged" value={o.flagged} fmt="number" locale="en" index={2} />
        <Kpi label="Waiting for review" value={o.open} fmt="number" locale="en" index={3} />
        <Kpi label="Confirmed fraud" value={o.fraud} fmt="number" locale="en" index={4} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Which checks fire" table={{ head: ["Check", "Points", "Orders"], rows: o.byRule.map((r) => [r.label, `+${r.points}`, String(r.count)]), align: ["left", "right", "right"] }}>
          <BarList rows={o.byRule.map((r) => ({ key: r.rule, label: `${r.label} (+${r.points})`, value: r.count }))} fmt="number" locale="en" testId="by-rule" />
        </ChartCard>
        <Card>
          <CardHeader><CardTitle>Riskiest customers</CardTitle></CardHeader>
          <CardContent>
            <Table data-testid="riskiest">
              <THead><TR><TH>Customer</TH><TH className="text-right">Checks</TH><TH className="text-right">Top score</TH><TH className="text-right">Fraud</TH></TR></THead>
              <TBody>
                {o.riskiest.map((b) => <TR key={b.id}><TD>{b.name}</TD><TD className="text-right tabular-nums">{b.count}</TD><TD className="text-right tabular-nums">{b.maxScore}</TD><TD className="text-right tabular-nums">{b.fraud}</TD></TR>)}
                {!o.riskiest.length && <EmptyRow colSpan={4}>No risky orders in the last 30 days.</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Rules and thresholds</CardTitle></CardHeader>
        <CardContent>{can(ctx, "admin.risk.manage") ? <RiskSettingsForm settings={settings} /> : <p className="text-sm">Hold from {settings.holdScore}, review from {settings.flagScore}. {settings.enabled ? "On." : "Off."}</p>}</CardContent>
      </Card>
    </>
  );
}
