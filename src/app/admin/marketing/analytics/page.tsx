import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { marketingAnalytics } from "@/server/marketing/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { BarList, ChartCard } from "@/components/analytics/charts";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Marketing Analytics" };
const KIND: Record<string, string> = { PERCENT: "% off products", FIXED_AMOUNT: "€ off per unit", ORDER_AMOUNT: "€ off the order", FREE_DELIVERY: "Free delivery", BUY_X_GET_Y: "Buy X, get Y free" };
const PERIODS = [30, 90, 365];

export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.pricing.view"]);
  const days = PERIODS.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const to = new Date(Date.now() + 60_000), from = new Date(Date.now() - days * 86400_000);
  const a = await marketingAnalytics(ctx, { from, to });
  const m = (v: number) => formatMoney(v, "en");
  return (
    <>
      <PageHeader title="Marketing Analytics" description="What offers and coupons cost and who paid, how much was sold with them, and what campaigns brought in. Orders placed in the period, cancelled ones left out." />
      <div className="mb-4 flex gap-2">{PERIODS.map((d) => <Link key={d} href={`?days=${d}`} className={`rounded-md border px-3 py-1 text-sm ${d === days ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{d} days</Link>)}</div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="marketing-kpis">
        <Kpi label="Discounts given" value={a.discount} fmt="money" locale="en" hint={`FIRINGI ${m(a.firingiPaid)} · suppliers ${m(a.vendorPaid)}`} index={0} />
        <Kpi label="Orders with an offer" value={a.ordersWithOffer} fmt="number" locale="en" hint={`of ${a.orders} orders`} index={1} />
        <Kpi label="Goods sold with an offer" value={a.goodsWithOffer} fmt="money" locale="en" hint={a.goods ? `${Math.round((a.goodsWithOffer / a.goods) * 100)} % of all goods` : undefined} index={2} />
        <Kpi label="Coupon orders" value={a.couponUses} fmt="number" locale="en" index={3} />
        <Kpi label="Cost per € sold" value={a.goodsWithOffer ? a.discount / a.goodsWithOffer : 0} fmt="percent" locale="en" index={4} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <ChartCard title="Discount by kind of offer" table={{ head: ["Kind", "Uses", "Discount"], rows: a.byKind.map((k) => [KIND[k.kind] ?? k.kind, String(k.uses), m(k.amount)]), align: ["left", "right", "right"] }}>
          <BarList rows={a.byKind.map((k) => ({ key: k.kind, label: KIND[k.kind] ?? k.kind, value: k.amount, hint: `${k.uses} uses` }))} fmt="money" locale="en" testId="by-kind" emptyText="No offers used in this period." />
        </ChartCard>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Top offers and coupons</CardTitle></CardHeader>
          <CardContent>
            <Table data-testid="top-offers">
              <THead><TR><TH>Offer</TH><TH>By</TH><TH className="text-right">Orders</TH><TH className="text-right">Discount</TH><TH className="text-right">FIRINGI paid</TH><TH className="text-right">Supplier paid</TH></TR></THead>
              <TBody>
                {a.top.map((t) => <TR key={t.id}><TD>{t.code && <span className="mr-2 font-mono font-semibold">{t.code}</span>}{t.name}<div className="text-xs text-muted-foreground">{KIND[t.kind]}</div></TD><TD className="text-xs">{t.owner}</TD><TD className="text-right tabular-nums">{t.orders}</TD><TD className="text-right tabular-nums">{m(t.amount)}</TD><TD className="text-right tabular-nums">{m(t.firingi)}</TD><TD className="text-right tabular-nums">{m(t.vendor)}</TD></TR>)}
                {!a.top.length && <EmptyRow colSpan={6}>No offers used in this period.</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Campaigns sent in the period</CardTitle></CardHeader>
        <CardContent>
          <Table data-testid="campaign-results">
            <THead><TR><TH>Campaign</TH><TH className="text-right">Delivered</TH><TH className="text-right">Clicked</TH><TH className="text-right">Orders</TH><TH className="text-right">Goods sold</TH><TH className="text-right">Offer cost</TH></TR></THead>
            <TBody>
              {a.campaigns.map((c) => <TR key={c.id}><TD><Link className="text-primary hover:underline" href={`/admin/marketing/campaigns/${c.id}`}>{c.name}</Link><div className="text-xs text-muted-foreground">{c.channels.join(", ").toLowerCase()}</div></TD><TD className="text-right tabular-nums">{c.stats.sent}</TD><TD className="text-right tabular-nums">{c.stats.clicked}</TD><TD className="text-right tabular-nums">{c.stats.orders}</TD><TD className="text-right tabular-nums">{m(c.stats.revenue)}</TD><TD className="text-right tabular-nums">{m(c.stats.discount)}</TD></TR>)}
              {!a.campaigns.length && <EmptyRow colSpan={6}>No campaigns sent in this period.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
