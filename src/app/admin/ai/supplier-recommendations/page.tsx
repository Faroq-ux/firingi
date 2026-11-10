import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { supplierRecommendations } from "@/server/ai/insights";
import { NoAccess, SuggestOnly, aiPage, eur, num } from "../_kit";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Supplier Recommendations" };
const REASON = { CHEAPER: "Cheaper", BETTER_SERVICE: "More reliable", BOTH: "Cheaper & more reliable" } as const;

export default async function Page() {
  const { ctx, allowed } = await aiPage(["admin.vendors.view", "admin.allocation.manage", "admin.pricing.view"]);
  const header = <PageHeader title="Supplier Recommendations" description="The same product (same pack) from another supplier at the same level — cheaper with enough stock for a week's demand, or clearly more reliable (scorecard +15) at a similar price. Use it for allocation rules or a talk with the supplier." />;
  if (!allowed) return <>{header}<NoAccess what="supplier prices and scorecards" /></>;
  const rows = await supplierRecommendations(ctx);
  return (
    <>
      {header}
      <SuggestOnly />
      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="supplier-kpis">
        <Kpi label="Products with a better option" value={rows.length} fmt="number" locale="en" index={0} />
        <Kpi label="Possible saving / week" value={rows.reduce((a, r) => a + r.weeklySaving, 0)} fmt="money" locale="en" index={1} />
        <Kpi label="Possible saving / year" value={rows.reduce((a, r) => a + r.weeklySaving, 0) * 52} fmt="money" locale="en" index={2} />
      </div>
      <Card><CardContent className="pt-4">
        <Table data-testid="supplier-table">
          <THead><TR><TH>Product</TH><TH>Bought from</TH><TH>Alternative</TH><TH className="text-right">Units / week</TH><TH className="text-right">Saving / week</TH><TH>Why</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={`${r.currentOfferId}${r.betterOfferId}`}>
                <TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD>
                <TD>{r.current}<div className="text-xs text-muted-foreground">{eur(r.currentPrice, 2)} · score {r.currentScore ?? "—"}</div></TD>
                <TD className="font-medium">{r.better}<div className="text-xs font-normal text-muted-foreground">{eur(r.betterPrice, 2)} · score {r.betterScore ?? "—"} · {r.betterStock} in stock</div></TD>
                <TD className="text-right tabular-nums">{num(r.weeklyUnits)}</TD>
                <TD className="text-right font-semibold tabular-nums">{eur(r.weeklySaving, 2)}</TD>
                <TD><Badge variant={r.reason === "CHEAPER" ? "default" : "success"}>{REASON[r.reason]}</Badge></TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={6}>Every product is bought from its best available supplier.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
