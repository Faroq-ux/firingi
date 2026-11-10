import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { routeProfitability } from "@/server/services/profit";
import { periodFrom } from "@/server/services/route-stats";
import { routingSettings } from "@/server/services/routes";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { PeriodForm } from "@/components/routes/period-form";
import { eur } from "@/components/crm/views";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Route Profitability" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.analytics.view"]);
  const p = periodFrom(await searchParams);
  const [rows, s] = await Promise.all([routeProfitability(ctx, p), routingSettings()]);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const km = sum((r) => r.km);
  return (
    <>
      <PageHeader title="Route Profitability" description={`Completed FIRINGI routes: delivery fees collected (and the goods margin of their orders) against driver pay (${eur(s.pay.perRoute)}/route + ${eur(s.pay.perDelivery)}/delivery + ${eur(s.pay.perKm)}/km) and vehicle cost (${eur(s.vehicleCostPerKm)}/km — set under Drivers & Fleet › Driver Earnings).`} />
      <PeriodForm from={d(p.from)} to={d(p.to)} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Routes" value={rows.length} fmt="number" locale="pt-PT" tone="tone-blue" index={0} hint={`${sum((r) => r.delivered)} deliveries · ${km.toFixed(0)} km`} />
        <Kpi label="Fees collected" value={sum((r) => r.fees)} fmt="money" locale="pt-PT" tone="tone-teal" index={1} />
        <Kpi label="Route cost" value={sum((r) => r.cost)} fmt="money" locale="pt-PT" tone="tone-orange" index={2} />
        <Kpi label="Delivery result" value={sum((r) => r.deliveryProfit)} fmt="money" locale="pt-PT" tone="tone-pink" index={3} hint="fees − cost" />
        <Kpi label="With goods margin" value={sum((r) => r.totalProfit)} fmt="money" locale="pt-PT" tone="tone-lime" index={4} hint={km ? `${eur(sum((r) => r.totalProfit) / km)} per km` : undefined} />
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="route-profit">
          <THead><TR><TH>Route</TH><TH>Date</TH><TH>Driver</TH><TH className="text-right">Delivered</TH><TH className="text-right">Km</TH><TH className="text-right">Fees</TH><TH className="text-right">Margin</TH><TH className="text-right">Driver pay</TH><TH className="text-right">Vehicle</TH><TH className="text-right">Delivery result</TH><TH className="text-right">Total</TH><TH className="text-right">Per stop</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link className="font-medium text-primary hover:underline" href={`/admin/delivery/routes/${r.id}`}>{r.number}</Link></TD>
                <TD>{formatDate(r.date, "en-GB")}</TD><TD>{r.driver}</TD><TD className="text-right tabular-nums">{r.delivered}/{r.stops}</TD><TD className="text-right tabular-nums">{r.km}</TD>
                <TD className="text-right tabular-nums">{eur(r.fees)}</TD><TD className="text-right tabular-nums">{eur(r.margin)}</TD><TD className="text-right tabular-nums">{eur(r.driverPay)}</TD><TD className="text-right tabular-nums">{eur(r.vehicle)}</TD>
                <TD className={`text-right tabular-nums ${r.deliveryProfit < 0 ? "text-destructive" : "text-success"}`}>{eur(r.deliveryProfit)}</TD>
                <TD className={`text-right font-semibold tabular-nums ${r.totalProfit < 0 ? "text-destructive" : "text-success"}`}>{eur(r.totalProfit)}</TD>
                <TD className="text-right tabular-nums">{r.perStop === null ? "—" : eur(r.perStop)}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={12}>No completed FIRINGI routes in this period.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
