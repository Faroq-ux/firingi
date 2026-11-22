import { Handshake } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminSalesRepSettings } from "@/components/salesreps/client";
import { Tiles } from "@/components/salesreps/views";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Sales reps" };
export const dynamic = "force-dynamic";

export default async function AdminSalesRepsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.settings.manage"]);
  const { month } = await searchParams;
  const v = await adminOverview(ctx, month);
  const m = (n: number) => formatMoney(n, "en");
  const sum = (k: "customers" | "visitsDone" | "repOrders" | "delivered") => v.reps.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <PageHeader title="Sales reps" description="Suppliers' field sales reps: customers, visits, orders they take (customers confirm, or let them order directly) and what their customers bought. Commission is between the supplier and its rep — FIRINGI only reports it and still invoices every order." icon={Handshake} />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="space-y-1 text-sm"><span className="block">Month</span><Input type="month" name="month" defaultValue={v.month} className="w-44" /></label>
        <Button type="submit" variant="outline">Show</Button>
      </form>
      <Tiles items={[
        { label: "Suppliers with reps", value: String(v.vendors.length) },
        { label: "Active reps", value: `${v.reps.filter((r) => r.active).length} / ${v.reps.length}` },
        { label: "Visits done / orders taken", value: `${sum("visitsDone")} / ${sum("repOrders")}` },
        { label: "Delivered net from rep customers", value: m(sum("delivered")) },
      ]} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Suppliers</CardTitle></CardHeader>
            <CardContent>
              {!v.vendors.length ? <p className="text-sm text-muted-foreground">No supplier has reps yet.</p> : (
                <ul className="divide-y text-sm" data-testid="asr-vendors">
                  {v.vendors.map((x) => <li key={x.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2"><span className="min-w-0 flex-1 basis-48 font-medium break-words">{x.vendor}</span><span>{x.active}/{x.reps} reps</span><span>{x.customers} customers</span><span>{x.visitsDone} visits</span><span>{x.repOrders} orders taken</span><span className="tabular-nums">{m(x.delivered)}</span></li>)}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Reps</CardTitle><CardDescription>{v.month}</CardDescription></CardHeader>
            <CardContent>
              {!v.reps.length ? <p className="text-sm text-muted-foreground">No reps yet.</p> : (
                <ul className="divide-y text-sm" data-testid="asr-reps">
                  {v.reps.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                      <span className="min-w-0 flex-1 basis-48 break-words"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">· {r.vendor}</span></span>
                      <Badge variant={r.active ? "success" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge>
                      <span>{r.customers} customers</span><span>{r.visitsDone}/{r.visitsPlanned} visits</span><span>{r.repOrders} taken · {r.repOrdersPending} waiting</span>
                      <span className="tabular-nums">{m(r.delivered)}</span><span className="tabular-nums text-muted-foreground">commission {m(r.commission)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Switched off: suppliers can&apos;t add reps or take orders; customers can&apos;t confirm new ones.</CardDescription></CardHeader>
          <CardContent>{ctx.permissions.has("admin.settings.manage") ? <AdminSalesRepSettings settings={v.settings} /> : <p className="text-sm">{v.settings.enabled ? "On" : "Off"}</p>}</CardContent>
        </Card>
      </div>
    </>
  );
}
