import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { marginOpportunities } from "@/server/ai/insights";
import { Level, NoAccess, SuggestOnly, aiPage, eur } from "../_kit";

export const metadata = { title: "Margin Opportunities" };

export default async function Page() {
  const { ctx, allowed } = await aiPage(["admin.finance.view", "admin.pricing.view", "admin.pricing.manage"]);
  const header = <PageHeader title="Margin Opportunities" description="Offers whose FIRINGI margin is below the margin rules, sized by what they sold in the last 8 weeks: the € a year FIRINGI misses at the current volume." />;
  if (!allowed) return <>{header}<NoAccess what="margins" /></>;
  const rows = await marginOpportunities(ctx);
  return (
    <>
      {header}
      <SuggestOnly />
      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="margin-kpis">
        <Kpi label="Offers below the rules" value={rows.length} fmt="number" locale="en" index={0} />
        <Kpi label="Below the minimum" value={rows.filter((r) => r.below === "MIN").length} fmt="number" locale="en" index={1} />
        <Kpi label="Missed margin / year" value={rows.reduce((a, r) => a + r.yearlyGap, 0)} fmt="money" locale="en" index={2} />
      </div>
      <Card><CardContent className="pt-4">
        <Table data-testid="margin-table">
          <THead><TR><TH>Supplier</TH><TH>Product</TH><TH className="text-right">Margin</TH><TH className="text-right">Rule</TH><TH className="text-right">Sold, 8 weeks</TH><TH className="text-right">Missed / year</TH><TH /></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.offerId}>
                <TD className="font-medium">{r.vendor}</TD>
                <TD>{r.product}<div className="text-xs text-muted-foreground">{r.sku}</div></TD>
                <TD className="text-right tabular-nums">{r.margin}%</TD>
                <TD className="text-right tabular-nums">{r.goal}%</TD>
                <TD className="text-right tabular-nums">{eur(r.netLast8Weeks)}</TD>
                <TD className="text-right font-semibold tabular-nums">{eur(r.yearlyGap)}</TD>
                <TD><Level value={r.below}>{r.below === "MIN" ? "below minimum" : "below target"}</Level></TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={7}>No offer is below the margin rules. <Link className="text-primary underline-offset-4 hover:underline" href="/admin/pricing/margin">Margin rules</Link></EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
