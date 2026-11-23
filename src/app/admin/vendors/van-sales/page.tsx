import { Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/vansales/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminVanSettings, NetNow, SwitchOffVendor, VendorSwitch } from "@/components/vansales/client";
import { LoadBadge, Tiles } from "@/components/vansales/views";
import { vsLabels } from "@/components/vansales/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Van sales" };
export const dynamic = "force-dynamic";

export default async function AdminVanSalesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.settings.manage", "admin.finance.view"]);
  const [{ l }, o] = await Promise.all([vsLabels(true), adminOverview(ctx)]);
  const m = (n: number) => formatMoney(n, "en");
  const d = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");
  return (
    <>
      <PageHeader title="Van sales" icon={Truck}
        description="Suppliers sell from their vans to registered customers. Every sale is a FIRINGI order, delivered on the spot and invoiced by FIRINGI; money taken on the spot is netted from the supplier's payouts." />
      <Tiles items={[
        { label: "Vans on the road", value: String(o.kpis.onRoad) },
        { label: "Sales (30 days)", value: `${o.kpis.sales30} · ${m(o.kpis.gross30)}` },
        { label: "Collected, not netted yet", value: m(o.kpis.owed), testid: "vsa-owed" },
        { label: "Cash differences (30 days)", value: m(o.kpis.variance30) },
      ]} />
      <Card className="mb-6">
        <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Switch van sales and each payment method on or off; limits and alerts.</CardDescription></CardHeader>
        <CardContent><AdminVanSettings settings={o.settings} /></CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>Suppliers</CardTitle><CardDescription>Van sales in the last 30 days, money still to net, and the switch per supplier.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {!o.suppliers.length ? <p className="text-sm text-muted-foreground">No van sales yet.</p> : (
            <ul className="divide-y" data-testid="vsa-suppliers">
              {o.suppliers.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm" data-testid="vsa-supplier">
                  <span className="min-w-0 flex-1 basis-48 font-medium break-words">{s.name}</span>
                  <span>{s.sales} sales · {m(s.gross)}</span>
                  <span>Paid on the spot {m(s.paidOnSpot)}</span>
                  <span className={s.owed > 0 ? "font-medium" : "text-muted-foreground"}>To net {m(s.owed)}</span>
                  {s.owed > 0 && <NetNow vendorId={s.id} />}
                  <VendorSwitch vendorId={s.id} on={s.on} />
                </li>
              ))}
            </ul>
          )}
          {o.disabled.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Switched off for</p>
              <ul className="divide-y rounded-md border" data-testid="vsa-disabled">{o.disabled.map((v) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 break-words">{v.name}</span><VendorSwitch vendorId={v.id} on={false} /></li>)}</ul>
            </div>
          )}
          <div className="space-y-2"><p className="text-sm font-medium">Switch off for a supplier</p><SwitchOffVendor /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Van loads</CardTitle></CardHeader>
        <CardContent>
          {!o.loads.length ? <p className="text-sm text-muted-foreground">No van loads yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="vsa-loads">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">Load</th><th className="px-2">Supplier</th><th className="px-2">Seller</th><th className="px-2">Status</th><th className="px-2 text-right">Sales</th><th className="px-2 text-right">Total</th><th className="px-2 text-right">Cash expected</th><th className="px-2 text-right">Counted</th><th className="px-2 text-right">Difference</th><th className="px-2">Unloaded</th></tr></thead>
                <tbody>
                  {o.loads.map((x) => (
                    <tr key={x.id} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium">{x.number}</td><td className="px-2">{x.supplier}</td><td className="px-2">{x.seller}</td>
                      <td className="px-2"><LoadBadge l={l} status={x.status} />{x.late && <Badge variant="destructive" className="ml-1">Late</Badge>}</td>
                      <td className="px-2 text-right tabular-nums">{x.sales}</td><td className="px-2 text-right tabular-nums">{m(x.gross)}</td><td className="px-2 text-right tabular-nums">{m(x.cashExpected)}</td>
                      <td className="px-2 text-right tabular-nums">{x.cashCounted == null ? "—" : m(x.cashCounted)}</td>
                      <td className={`px-2 text-right tabular-nums ${(x.cashVariance ?? 0) < 0 ? "text-destructive" : ""}`}>{x.cashVariance == null ? "—" : m(x.cashVariance)}</td>
                      <td className="px-2 text-xs">{d(x.closedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
