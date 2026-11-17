import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listTypes, vendorCustomers, vendorOverview } from "@/server/returnables/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdjustForm, CancelPickup, DropOffForm, PlanPickupForm } from "@/components/returnables/client";
import { BalancesTable, PICKUP_TONE, ReturnsList } from "@/components/returnables/views";
import { fill, rtLabels } from "@/components/returnables/labels";

export const metadata = { title: "Empties & Deposits" };
export const dynamic = "force-dynamic";

export default async function VendorEmptiesPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const { l, locale } = await rtLabels();
  const [v, types] = await Promise.all([vendorOverview(ctx, locale), listTypes(ctx, locale)]);
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const day = (d: Date | null) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d) : "—");
  const typeOpts = types.filter((t) => t.active).map((t) => ({ id: t.id, label: t.name }));
  const custOpts = await vendorCustomers(ctx);
  return (
    <>
      <PageHeader title={l.emptiesTitle} icon={PackageOpen} description={l.vendorIntro} actions={<a className="text-sm text-primary underline-offset-2 hover:underline" href="/api/returnables/statement?as=SUPPLIER" data-testid="statement-csv">{l.statementCsv}</a>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="by-type">
        {v.byType.map((t) => (
          <Card key={t.typeId}><CardContent className="space-y-1 pt-5 text-sm">
            <p className="break-words font-medium">{t.name}</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="type-out">{t.held}</p>
            <p className="text-xs text-muted-foreground">{fill(l.outAtCustomers, { n: t.customers })} · {money(t.depositValue)}</p>
            {t.overdue > 0 && <Badge variant="warning">{fill(l.overdueN, { n: t.overdue })}</Badge>}
          </CardContent></Card>
        ))}
        {!v.byType.length && <p className="text-sm text-muted-foreground sm:col-span-4">{l.noneOut}</p>}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.toCheck}</CardTitle><CardDescription>{l.toCheckHint}</CardDescription></CardHeader>
        <CardContent><ReturnsList l={l} locale={locale} rows={v.toCheck} href={(id) => `/vendor/orders/empties/${id}`} show="customer" /></CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.pickupsTitle}</CardTitle><CardDescription>{l.pickupsVendorHint}</CardDescription></CardHeader>
        <CardContent>
          {!v.pickups.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noPickups}</p> : (
            <ul className="divide-y" data-testid="vendor-pickups">
              {v.pickups.map((p) => (
                <li key={p.id} className="space-y-2 py-3 text-sm" data-testid="vendor-pickup" data-status={p.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{p.number}</span><Badge variant={PICKUP_TONE[p.status]}>{l[`pickup.${p.status}`]}</Badge>
                    <span className="min-w-0 flex-1 break-words font-medium">{p.customer}</span>
                    <span className="basis-full break-words text-xs text-muted-foreground sm:basis-auto">{p.address}</span>
                  </div>
                  <p>{p.lines.map((x) => `${x.qty} × ${x.name}`).join(", ")}{p.preferredDate ? ` · ${fill(l.preferredOn, { date: day(p.preferredDate) })}` : ""}{p.note ? ` · “${p.note}”` : ""}</p>
                  {p.status === "PLANNED" && <p className="text-xs">{fill(l.plannedWith, { date: day(p.plannedDate), driver: p.driver ?? "—" })}</p>}
                  <div className="flex flex-wrap items-end gap-2"><PlanPickupForm l={l} id={p.id} drivers={v.drivers} /><CancelPickup l={l} id={p.id} /></div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.balancesTitle}</CardTitle></CardHeader>
        <CardContent><BalancesTable l={l} locale={locale} rows={v.balances} by="customer" /></CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{l.dropOffTitle}</CardTitle><CardDescription>{l.dropOffHint}</CardDescription></CardHeader><CardContent><DropOffForm l={l} customers={custOpts} types={typeOpts} /></CardContent></Card>
        <Card><CardHeader><CardTitle>{l.adjustTitle}</CardTitle><CardDescription>{l.adjustHint}</CardDescription></CardHeader><CardContent><AdjustForm l={l} customers={custOpts} types={typeOpts} /></CardContent></Card>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>{l.recentReturns}</CardTitle><CardDescription><Link href="/vendor/products/returnables" className="text-primary underline-offset-2 hover:underline">{l.manageItems}</Link></CardDescription></CardHeader>
        <CardContent><ReturnsList l={l} locale={locale} rows={v.returns} href={(id) => `/vendor/orders/empties/${id}`} show="customer" /></CardContent>
      </Card>
    </>
  );
}
