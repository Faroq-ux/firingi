import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { stockPredictions } from "@/server/ai/insights";
import { Level, NoAccess, SuggestOnly, aiPage, num } from "../_kit";

export const metadata = { title: "Stock Predictions" };

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { ctx, allowed } = await aiPage(["admin.catalogue.view", "admin.orders.view", "admin.allocation.manage"]);
  const header = <PageHeader title="Stock Predictions" description="Days of stock left per supplier offer at the recent selling rate (last 4 weeks, or the forecast when demand is rising). Critical: under 7 days; low: under 14." />;
  if (!allowed) return <>{header}<NoAccess what="supplier stock" /></>;
  const all = (await searchParams).all === "1";
  const rows = await stockPredictions(ctx, "STAFF");
  const shown = all ? rows : rows.filter((r) => r.status === "OUT" || r.status === "CRITICAL" || r.status === "LOW");
  const n = (s: string) => rows.filter((r) => r.status === s && r.dailyUnits > 0).length;
  return (
    <>
      {header}
      <SuggestOnly />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="stock-kpis">
        <Kpi label="Out of stock (selling)" value={n("OUT")} fmt="number" locale="en" index={0} />
        <Kpi label="Critical (< 7 days)" value={n("CRITICAL")} fmt="number" locale="en" index={1} />
        <Kpi label="Low (< 14 days)" value={n("LOW")} fmt="number" locale="en" index={2} />
        <Kpi label="Offers with stock" value={rows.length} fmt="number" locale="en" index={3} />
      </div>
      <p className="mb-2 text-sm"><a className="text-primary underline-offset-4 hover:underline" href={all ? "?" : "?all=1"}>{all ? "Show only products at risk" : "Show all products"}</a></p>
      <Card><CardContent className="pt-4">
        <Table data-testid="stock-table">
          <THead><TR><TH>Product</TH><TH>Supplier</TH><TH className="text-right">Available</TH><TH className="text-right">Sells / day</TH><TH className="text-right">Days left</TH><TH>Runs out</TH><TH>Status</TH></TR></THead>
          <TBody>
            {shown.map((r) => (
              <TR key={r.offerId}>
                <TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD>
                <TD>{r.vendor}</TD>
                <TD className="text-right tabular-nums">{r.available}</TD>
                <TD className="text-right tabular-nums">{num(r.dailyUnits)}</TD>
                <TD className="text-right font-semibold tabular-nums">{r.days ?? "—"}</TD>
                <TD className="tabular-nums">{r.runsOutOn ?? "—"}</TD>
                <TD><Level value={r.status} /></TD>
              </TR>
            ))}
            {!shown.length && <EmptyRow colSpan={7}>{all ? "No stock recorded." : "Nothing is about to run out."}</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
