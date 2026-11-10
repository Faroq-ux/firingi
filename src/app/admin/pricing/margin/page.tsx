import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listMarginRules, marginRuleOptions, marginWatch } from "@/server/services/performance";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { MarginRuleForm, RemoveRule } from "@/components/profit/forms";
import { pretty } from "@/components/crm/views";

export const metadata = { title: "Margin Rules" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const manage = can(ctx, "admin.pricing.manage");
  const [rules, opts, watch] = await Promise.all([listMarginRules(ctx), marginRuleOptions(ctx), marginWatch(ctx)]);
  return (
    <>
      <PageHeader title="Margin Rules" description="The minimum (and target) margin FIRINGI wants. The customer pays the supplier's price; FIRINGI keeps the commission. The most specific rule applies: supplier › category › country › everything. Supplier allocation never moves an order to a supplier below the minimum (unless overridden), and offers below the minimum or target are listed here." />
      <Card className="mb-4">
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {manage && <MarginRuleForm countries={opts.countries} categories={opts.categories} vendors={opts.vendors} />}
          <Table data-testid="margin-rules">
            <THead><TR><TH>Applies to</TH><TH>Level</TH><TH className="text-right">Minimum</TH><TH className="text-right">Target</TH><TH>Note</TH>{manage && <TH />}</TR></THead>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.target}</TD><TD><Badge variant="secondary">{pretty(r.scope)}</Badge></TD>
                  <TD className="text-right tabular-nums">{r.min.toFixed(1)} %</TD><TD className="text-right tabular-nums">{r.goal === null ? "—" : `${r.goal.toFixed(1)} %`}</TD>
                  <TD className="text-muted-foreground">{r.note ?? ""}</TD>{manage && <TD><RemoveRule id={r.id} /></TD>}
                </TR>
              ))}
              {!rules.length && <EmptyRow colSpan={manage ? 6 : 5}>No margin rules — allocation uses its own minimum (Supplier Allocation › Margin Rules).</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Offers below the rule ({watch.length})</CardTitle></CardHeader>
        <CardContent>
          <Table data-testid="margin-watch">
            <THead><TR><TH>Supplier</TH><TH>Product</TH><TH>SKU</TH><TH className="text-right">Margin (commission)</TH><TH className="text-right">Minimum</TH><TH className="text-right">Target</TH><TH /></TR></THead>
            <TBody>
              {watch.slice(0, 200).map((w) => (
                <TR key={w.offerId}>
                  <TD>{w.vendor}</TD><TD>{w.product}</TD><TD className="font-mono text-xs">{w.sku}</TD>
                  <TD className="text-right tabular-nums">{w.margin.toFixed(1)} %</TD><TD className="text-right tabular-nums">{w.min.toFixed(1)} %</TD><TD className="text-right tabular-nums">{w.goal === null ? "—" : `${w.goal.toFixed(1)} %`}</TD>
                  <TD>{w.below === "MIN" ? <Badge variant="destructive">Below minimum</Badge> : <Badge variant="warning">Below target</Badge>}</TD>
                </TR>
              ))}
              {!watch.length && <EmptyRow colSpan={7}>{rules.length ? "Every active offer meets its rule." : "Add a rule to check the offers."}</EmptyRow>}
            </TBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Raise a supplier&apos;s commission under Supplier Management › Commission to lift its margin.</p>
        </CardContent>
      </Card>
    </>
  );
}
