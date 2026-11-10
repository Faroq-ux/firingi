import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { reorderPredictions } from "@/server/ai/insights";
import { Level, NoAccess, SuggestOnly, aiPage, eur } from "../_kit";

export const metadata = { title: "Customer Reorder Predictions" };

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { ctx, allowed } = await aiPage(["admin.customers.view", "admin.crm.view", "admin.orders.view"]);
  const header = <PageHeader title="Customer Reorder Predictions" description="Each customer's usual rhythm per supplier (median days between orders, last 6 months) — when the next order is expected, how late it is, and what it usually contains. Late customers are worth a call." />;
  if (!allowed) return <>{header}<NoAccess what="customer orders" /></>;
  const all = (await searchParams).all === "1";
  const rows = await reorderPredictions(ctx, "STAFF");
  const shown = all ? rows : rows.filter((r) => r.overdueDays >= -2);
  const late = rows.filter((r) => r.overdueDays >= 2);
  return (
    <>
      {header}
      <SuggestOnly />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="reorder-kpis">
        <Kpi label="Regular customer–supplier pairs" value={rows.length} fmt="number" locale="en" index={0} />
        <Kpi label="Due in 2 days or late" value={shown.length} fmt="number" locale="en" index={1} />
        <Kpi label="Late (2+ days)" value={late.length} fmt="number" locale="en" index={2} />
        <Kpi label="Usual value of late orders" value={late.reduce((a, r) => a + r.usualNet, 0)} fmt="money" locale="en" index={3} />
      </div>
      <p className="mb-2 text-sm"><a className="text-primary underline-offset-4 hover:underline" href={all ? "?" : "?all=1"}>{all ? "Show only due and late" : "Show all regular customers"}</a></p>
      <Card><CardContent className="pt-4">
        <Table data-testid="reorder-table">
          <THead><TR><TH>Customer</TH><TH>Supplier</TH><TH className="text-right">Every</TH><TH>Last order</TH><TH>Expected</TH><TH className="text-right">Usual order</TH><TH>Usual basket</TH><TH /></TR></THead>
          <TBody>
            {shown.map((r) => (
              <TR key={`${r.buyerId}${r.sellerId}`}>
                <TD className="font-medium">{r.buyer}</TD>
                <TD>{r.seller}</TD>
                <TD className="text-right tabular-nums">{r.gapDays} d</TD>
                <TD className="tabular-nums">{r.lastOrder}</TD>
                <TD className="tabular-nums">{r.expected}</TD>
                <TD className="text-right tabular-nums">{eur(r.usualNet, 2)}</TD>
                <TD className="max-w-72 text-xs text-muted-foreground">{r.basket.slice(0, 4).map((b) => `${b.qty} × ${b.product}`).join(", ")}{r.basket.length > 4 ? ` +${r.basket.length - 4}` : ""}</TD>
                <TD>{r.overdueDays >= 2 ? <Level value="HIGH">{r.overdueDays} days late</Level> : r.overdueDays >= 0 ? <Level value="MEDIUM">due</Level> : <Level value="OK">in {-r.overdueDays} d</Level>}</TD>
              </TR>
            ))}
            {!shown.length && <EmptyRow colSpan={8}>No customer is due to reorder.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
