import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { driverEarnings, periodFrom } from "@/server/services/route-stats";
import { depotOptions, routingSettings } from "@/server/services/routes";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";
import { PeriodForm } from "@/components/routes/period-form";
import { RoutingSettingsForm } from "@/components/routes/route-forms";

export const metadata = { title: "Driver Earnings" };
const eur = (v: number) => formatMoney(v, "pt-PT");

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.finance.view"]);
  const sp = await searchParams;
  const p = periodFrom(sp);
  const [e, values, depots] = await Promise.all([driverEarnings(ctx, p), routingSettings(), depotOptions(ctx)]);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Driver Earnings" description="What FIRINGI's own drivers earned in the period: per completed route, per planned km, and per delivered order where the customer paid a delivery fee or flat rate (free deliveries earn no per-delivery pay). Quality-claim charge-backs for delivery faults are deducted. Suppliers' own drivers are the suppliers' staff — FIRINGI pays them nothing." />
      <PeriodForm from={d(p.from)} to={d(p.to)} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>Total {eur(e.total)}</CardTitle></CardHeader>
          <CardContent>
            <Table data-testid="driver-earnings">
              <THead><TR><TH>Driver</TH><TH className="text-right">Routes</TH><TH className="text-right">Delivered</TH><TH className="text-right">Fee-paid</TH><TH className="text-right">Km</TH><TH className="text-right">Routes €</TH><TH className="text-right">Deliveries €</TH><TH className="text-right">Km €</TH><TH className="text-right">Claim deductions</TH><TH className="text-right">Total</TH></TR></THead>
              <TBody>
                {e.rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.name}</TD>
                    <TD className="text-right tabular-nums">{r.routes}</TD><TD className="text-right tabular-nums">{r.delivered}</TD><TD className="text-right tabular-nums">{r.feePaid}</TD><TD className="text-right tabular-nums">{r.km.toFixed(1)}</TD>
                    <TD className="text-right tabular-nums">{eur(r.routePay)}</TD><TD className="text-right tabular-nums">{eur(r.deliveryPay)}</TD><TD className="text-right tabular-nums">{eur(r.kmPay)}</TD><TD className="text-right tabular-nums">{r.deductions ? <span className="text-destructive">−{eur(r.deductions)}</span> : "—"}</TD>
                    <TD className="text-right font-medium tabular-nums">{eur(r.total)}</TD>
                  </TR>
                ))}
                {!e.rows.length && <EmptyRow colSpan={10}>No FIRINGI drivers.</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pay rates</CardTitle></CardHeader>
          <CardContent><RoutingSettingsForm values={values} depots={depots} canEdit={can(ctx, ["admin.fleet.manage", "admin.delivery.manage"])} only={["pay"]} /></CardContent>
        </Card>
      </div>
    </>
  );
}
