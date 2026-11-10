import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { cashFlow } from "@/server/services/profit";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { ChartCard, TimeChart } from "@/components/analytics/charts";
import { eur } from "@/components/crm/views";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Cash Flow" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const cf = await cashFlow(ctx, { months: 6, weeksAhead: 8 });
  const last = cf.rows[cf.rows.length - 1];
  const label = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const fIn = cf.forecast.reduce((a, w) => a + w.receivable, 0), fOut = cf.forecast.reduce((a, w) => a + w.payable + w.costs, 0);
  return (
    <>
      <PageHeader title="Cash Flow" description="Money actually received from customers and paid to suppliers (confirmed payments) and costs marked paid — and what falls due in the next 8 weeks: customers' open invoices, approved supplier invoices and running monthly costs." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="cash-kpis">
        <Kpi label="Received this month" value={last.inflow} fmt="money" locale="pt-PT" tone="tone-teal" index={0} />
        <Kpi label="Paid this month" value={last.suppliers + last.costs} fmt="money" locale="pt-PT" tone="tone-orange" index={1} hint={`suppliers ${eur(last.suppliers)} · costs ${eur(last.costs)}`} />
        <Kpi label="Next 8 weeks (net)" value={fIn - fOut} fmt="money" locale="pt-PT" tone={fIn - fOut >= 0 ? "tone-lime" : "tone-pink"} index={2} hint={`in ${eur(fIn)} · out ${eur(fOut)}`} />
        <Kpi label="Overdue from customers" value={cf.overdueReceivable} fmt="money" locale="pt-PT" tone="tone-pink" index={3} />
      </div>
      <ChartCard title="Money in and out per month" className="mb-4"
        table={{ head: ["Month", "In", "Suppliers", "Costs", "Net", "Cumulative"], rows: cf.rows.map((r) => [label(r.month), eur(r.inflow), eur(r.suppliers), eur(r.costs), eur(r.net), eur(r.cumulative)]), align: ["left", "right", "right", "right", "right", "right"] }}>
        <TimeChart points={cf.rows.map((r) => `${r.month}-01`)} grain="month" kind="bar" fmt="money" locale="pt-PT" testId="cash-chart"
          series={[{ key: "in", label: "Received", values: cf.rows.map((r) => r.inflow) }, { key: "out", label: "Paid (suppliers + costs)", values: cf.rows.map((r) => r.suppliers + r.costs) }]} />
      </ChartCard>
      <Card>
        <CardHeader><CardTitle>Next 8 weeks</CardTitle></CardHeader>
        <CardContent>
          <Table data-testid="cash-forecast">
            <THead><TR><TH>Week of</TH><TH className="text-right">Customers pay</TH><TH className="text-right">Suppliers due</TH><TH className="text-right">Costs</TH><TH className="text-right">Net</TH><TH className="text-right">Cumulative</TH></TR></THead>
            <TBody>
              {cf.forecast.map((w) => (
                <TR key={w.week}>
                  <TD>{formatDate(w.week, "en-GB")}</TD>
                  <TD className="text-right tabular-nums text-success">{eur(w.receivable)}</TD>
                  <TD className="text-right tabular-nums">{eur(w.payable)}</TD>
                  <TD className="text-right tabular-nums">{eur(w.costs)}</TD>
                  <TD className={`text-right font-semibold tabular-nums ${w.net < 0 ? "text-destructive" : ""}`}>{eur(w.net)}</TD>
                  <TD className={`text-right tabular-nums ${w.cumulative < 0 ? "text-destructive" : ""}`}>{eur(w.cumulative)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Invoices without a due date or already overdue are counted in the first week.</p>
        </CardContent>
      </Card>
    </>
  );
}
