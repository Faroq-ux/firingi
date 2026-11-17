import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/returnables/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BalancesTable, ReturnsList } from "@/components/returnables/views";
import { enLabels } from "@/components/returnables/labels";

export const metadata = { title: "Empties & Deposits" };
export const dynamic = "force-dynamic";

export default async function AdminEmptiesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.finance.view", "admin.settings.view", "admin.settings.manage"]);
  const l = enLabels();
  const v = await adminOverview(ctx);
  const money = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);
  return (
    <>
      <PageHeader title="Empties & Deposits" icon={PackageOpen} description="Crates, kegs, pallets and gas cylinders out at customers, the deposits they paid in, overdue empties and contested counts. Deposits pass through FIRINGI: invoiced to the customer, charged by the supplier, refunded by credit note."
        actions={<div className="flex flex-wrap gap-3 text-sm"><Link className="text-primary" href="/admin/catalogue/returnables">Returnable items</Link><Link className="text-primary" href="/admin/settings/returnables">Settings</Link><a className="text-primary" href="/api/returnables/statement?as=ADMIN" data-testid="statement-csv">Movements (CSV)</a></div>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-4" data-testid="admin-totals">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Units out</p><p className="text-2xl font-semibold tabular-nums">{v.totals.units}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Deposits held for customers</p><p className="text-2xl font-semibold tabular-nums">{money(v.totals.depositValue)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Overdue units</p><p className="text-2xl font-semibold tabular-nums">{v.totals.overdue}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Customers holding empties</p><p className="text-2xl font-semibold tabular-nums">{v.totals.customers}</p></CardContent></Card>
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Contested counts</CardTitle><CardDescription>The customer doesn&apos;t agree with the supplier&apos;s check. Decide: the customer&apos;s count (the difference is refunded) or the supplier&apos;s.</CardDescription></CardHeader>
        <CardContent><ReturnsList l={l} locale="en" rows={v.disputes} href={(id) => `/admin/orders/empties/${id}`} show="both" /></CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>Per supplier</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm" data-testid="by-supplier"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Supplier</th><th className="text-right">Units out</th><th className="text-right">Overdue</th><th className="text-right">Deposits</th><th className="text-right">Customers</th></tr></thead>
            <tbody>{v.bySupplier.map((s) => <tr key={s.id} className="border-b last:border-0"><td className="py-2">{s.supplier}</td><td className="text-right tabular-nums">{s.units}</td><td className="text-right tabular-nums">{s.overdue}</td><td className="text-right tabular-nums">{money(s.depositValue)}</td><td className="text-right tabular-nums">{s.customers}</td></tr>)}</tbody></table></div>
        </CardContent>
      </Card>
      <Card className="mb-6"><CardHeader><CardTitle>Balances (most overdue first)</CardTitle></CardHeader><CardContent><BalancesTable l={l} locale="en" rows={v.balances} by="customer" /></CardContent></Card>
      <Card><CardHeader><CardTitle>Recent returns</CardTitle></CardHeader><CardContent><ReturnsList l={l} locale="en" rows={v.returns} href={(id) => `/admin/orders/empties/${id}`} show="both" /></CardContent></Card>
    </>
  );
}
