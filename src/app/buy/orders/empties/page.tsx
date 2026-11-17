import { PackageOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { buyerOverview, pickupAddresses } from "@/server/returnables/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CancelPickup, PickupRequestForm } from "@/components/returnables/client";
import { BalancesTable, PICKUP_TONE, ReturnsList } from "@/components/returnables/views";
import { fill, rtLabels } from "@/components/returnables/labels";

export const metadata = { title: "Empties & Deposits" };
export const dynamic = "force-dynamic";

export default async function BuyerEmptiesPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"]);
  const { l, locale } = await rtLabels();
  const v = await buyerOverview(ctx, locale);
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const day = (d: Date | null) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d) : "—");
  const addresses = await pickupAddresses(ctx);
  const suppliers = [...new Map(v.balances.filter((b) => b.held > 0).map((b) => [b.supplierId, b.supplier])).entries()].map(([id, name]) => ({
    id, name, items: v.balances.filter((b) => b.supplierId === id && b.held > 0).map((b) => ({ typeId: b.typeId, name: b.name, held: b.held })),
  }));
  const total = v.balances.reduce((a, b) => a + b.depositValue, 0);
  const overdue = v.balances.filter((b) => b.overdue > 0);
  return (
    <>
      <PageHeader title={l.emptiesTitle} icon={PackageOpen} description={l.buyerIntro} actions={<a className="text-sm text-primary underline-offset-2 hover:underline" href="/api/returnables/statement?as=CUSTOMER" data-testid="statement-csv">{l.statementCsv}</a>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l.unitsHeld}</p><p className="text-2xl font-semibold tabular-nums" data-testid="units-held">{v.balances.reduce((a, b) => a + b.held, 0)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l.depositsPaidIn}</p><p className="text-2xl font-semibold tabular-nums" data-testid="deposits-paid">{money(total)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l.overdueTitle}</p><p className="text-2xl font-semibold tabular-nums">{overdue.reduce((a, b) => a + b.overdue, 0)}</p></CardContent></Card>
      </div>
      {overdue.length > 0 && (
        <Card className="mb-6 border-[color:var(--warning,#d97706)]" data-testid="overdue-warning"><CardContent className="space-y-1 pt-5 text-sm">
          {overdue.map((b) => <p key={`${b.supplierId}${b.typeId}`}>{fill(b.overdueAction === "KEEP" ? l.overdueKeep : l.overdueRemind, { n: b.overdue, name: b.name, supplier: b.supplier, days: b.overdueDays })}</p>)}
        </CardContent></Card>
      )}
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.whatYouHold}</CardTitle><CardDescription>{fill(l.holdHint, { days: v.settings.overdueDays })}</CardDescription></CardHeader>
        <CardContent><BalancesTable l={l} locale={locale} rows={v.balances} by="supplier" /></CardContent>
      </Card>
      {v.settings.pickups && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.requestPickup}</CardTitle><CardDescription>{l.pickupHint}</CardDescription></CardHeader>
          <CardContent><PickupRequestForm l={l} suppliers={suppliers} addresses={addresses} min={v.settings.pickupMinUnits} /></CardContent>
        </Card>
      )}
      {v.pickups.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.pickupsTitle}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="buyer-pickups">
              {v.pickups.map((p) => (
                <li key={p.id} className="space-y-1 py-3 text-sm" data-testid="buyer-pickup" data-status={p.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{p.number}</span><Badge variant={PICKUP_TONE[p.status]}>{l[`pickup.${p.status}`]}</Badge>
                    <span className="min-w-0 flex-1 break-words font-medium">{p.supplier}</span>
                    {p.status === "PLANNED" && <span className="text-xs">{fill(l.plannedOn, { date: day(p.plannedDate) })}</span>}
                  </div>
                  <p className="break-words">{p.lines.map((x) => `${x.qty} × ${x.name}`).join(", ")}</p>
                  {(p.status === "REQUESTED" || p.status === "PLANNED") && <CancelPickup l={l} id={p.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{l.recentReturns}</CardTitle></CardHeader>
        <CardContent><ReturnsList l={l} locale={locale} rows={v.returns} href={(id) => `/buy/orders/empties/${id}`} show="supplier" /></CardContent>
      </Card>
    </>
  );
}
