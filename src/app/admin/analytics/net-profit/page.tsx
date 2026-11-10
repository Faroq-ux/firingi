import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { netProfitBy, type ProfitDim } from "@/server/services/profit";
import { periodFrom } from "@/server/services/route-stats";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { BarList, ChartCard } from "@/components/analytics/charts";
import { PeriodForm } from "@/components/routes/period-form";
import { Pills, eur } from "@/components/crm/views";

export const metadata = { title: "Net Profit" };
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);

export default async function Page({ searchParams }: { searchParams: Promise<{ by?: string; from?: string; to?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.analytics.view"]);
  const sp = await searchParams;
  const by: ProfitDim = sp.by === "buyer" || sp.by === "country" ? sp.by : "vendor";
  const p = periodFrom(sp, 90);
  const rows = await netProfitBy(ctx, by, p);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const tot = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const head = by === "vendor" ? "Supplier" : by === "buyer" ? "Customer" : "Country";
  return (
    <>
      <PageHeader title="Net Profit" description="What each supplier, customer or country really earns FIRINGI: goods margin + FIRINGI delivery fees − the delivery cost (driver pay per order and each route's fixed part shared by its orders) − price differences FIRINGI absorbed − the margin given back with credit notes. By invoice date." />
      <div className="mb-2"><Pills items={[{ value: "vendor", label: "By supplier" }, { value: "buyer", label: "By customer" }, { value: "country", label: "By country" }]} current={by} param="by" base={{ from: d(p.from), to: d(p.to) }} /></div>
      <PeriodForm from={d(p.from)} to={d(p.to)} extra={{ by }} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue" value={tot((r) => r.revenue)} fmt="money" locale="pt-PT" tone="tone-blue" index={0} />
        <Kpi label="Margin + fees" value={tot((r) => r.margin + r.fees)} fmt="money" locale="pt-PT" tone="tone-teal" index={1} />
        <Kpi label="Delivery cost & absorbed" value={tot((r) => r.deliveryCost + r.absorbed)} fmt="money" locale="pt-PT" tone="tone-orange" index={2} />
        <Kpi label="Net profit" value={tot((r) => r.net)} fmt="money" locale="pt-PT" tone="tone-lime" index={3} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <ChartCard title={`Net profit by ${head.toLowerCase()}`}>
          <BarList rows={rows.slice(0, 12).map((r) => ({ key: r.id, label: r.name, value: r.net, hint: pct(r.netPct) }))} fmt="money" locale="pt-PT" testId="net-bars" emptyText="No invoiced orders in this period." />
        </ChartCard>
        <Card><CardContent className="pt-5">
          <Table data-testid="net-table">
            <THead><TR><TH>{head}</TH><TH className="text-right">Orders</TH><TH className="text-right">Revenue</TH><TH className="text-right">Margin</TH><TH className="text-right">Fees</TH><TH className="text-right">Delivery cost</TH><TH className="text-right">Absorbed</TH><TH className="text-right">Net</TH><TH className="text-right">Net %</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.name}</TD><TD className="text-right tabular-nums">{r.orders}</TD><TD className="text-right tabular-nums">{eur(r.revenue)}</TD>
                  <TD className="text-right tabular-nums">{eur(r.margin)}</TD><TD className="text-right tabular-nums">{eur(r.fees)}</TD><TD className="text-right tabular-nums">{eur(r.deliveryCost)}</TD>
                  <TD className="text-right tabular-nums">{eur(r.absorbed)}</TD><TD className={`text-right font-semibold tabular-nums ${r.net < 0 ? "text-destructive" : "text-success"}`}>{eur(r.net)}</TD><TD className="text-right tabular-nums">{pct(r.netPct)}</TD>
                </TR>
              ))}
              {!rows.length && <EmptyRow colSpan={9}>No invoiced orders in this period.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
    </>
  );
}
