import Link from "next/link";
import { Handshake } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { pendingForMe, salesRepSettings } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoConfirmToggle, DecideRepOrder } from "@/components/salesreps/client";
import { RepOrderBadge } from "@/components/salesreps/views";
import { fill, srLabels } from "@/components/salesreps/labels";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Orders from sales reps" };
export const dynamic = "force-dynamic";

export default async function BuyerRepOrdersPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const [{ l, locale }, v, s] = await Promise.all([srLabels(), pendingForMe(ctx), salesRepSettings()]);
  const canAct = ctx.permissions.has("buyer.orders.place");
  const m = (n: number) => formatMoney(n, locale);
  const pending = v.items.filter((x) => x.status === "PENDING");
  const done = v.items.filter((x) => x.status !== "PENDING");
  return (
    <>
      <PageHeader title={l.buyerTitle} description={l.buyerIntro} icon={Handshake} />
      {!s.enabled && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="sr-off">{l.off}</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4" data-testid="ro-pending">
          {!pending.length && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{l.noPending}</p>}
          {pending.map((r) => {
            const total = r.lines.reduce((a, x) => a + (x.unitNet ?? 0) * x.qty, 0);
            return (
              <Card key={r.id} data-testid="ro-card">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base"><span className="min-w-0 flex-1 break-words">{fill(l.takenBy, { rep: r.rep, supplier: r.supplier })}</span><RepOrderBadge l={l} status={r.status} /></CardTitle>
                  <CardDescription>{[fill(l.deliverTo, { address: r.address }), fill(l.expires, { date: formatDate(r.expiresAt, locale, true) })].join(" · ")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="divide-y text-sm" data-testid="ro-lines">
                    {r.lines.map((x) => (
                      <li key={x.offerId} className="flex flex-wrap gap-2 py-1.5">
                        <span className="min-w-0 flex-1 basis-40 break-words">{x.name} <span className="text-xs text-muted-foreground">{x.packaging}</span></span>
                        <span className="tabular-nums">{x.qty} × {x.unitNet == null ? "—" : m(x.unitNet)}</span>
                        <span className="w-24 text-right tabular-nums">{x.unitNet == null ? "—" : m(x.unitNet * x.qty)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span>{l.total}</span><span className="tabular-nums" data-testid="ro-total">{m(total)}</span></div>
                  {r.note && <p className="text-sm break-words">{r.note}</p>}
                  <p className="text-xs text-muted-foreground">{l.nowPriced}</p>
                  {canAct && <DecideRepOrder l={l} id={r.id} />}
                </CardContent>
              </Card>
            );
          })}
          {done.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">{l.historyTitle}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-sm" data-testid="ro-history">
                  {done.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="ro-done" data-status={r.status}>
                      <span className="min-w-0 flex-1 basis-48 break-words">{r.supplier} · {r.rep}<br /><span className="text-xs text-muted-foreground">{formatDate(r.createdAt, locale, true)}{r.auto ? ` · ${l.auto}` : ""}</span></span>
                      {r.orderIds.map((oid, i) => <Link key={oid} href={`/buy/orders/${oid}`} className="font-mono text-xs hover:underline">{r.orderNumbers[i]}</Link>)}
                      <span className="tabular-nums">{m(r.totalNet)}</span>
                      <RepOrderBadge l={l} status={r.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">{l.suppliersTitle}</CardTitle></CardHeader>
          <CardContent>
            {!v.suppliers.length ? <p className="text-sm text-muted-foreground">{l.noSuppliers}</p> : (
              <ul className="space-y-4" data-testid="ro-suppliers">
                {v.suppliers.map((x) => (
                  <li key={x.vendorCompanyId} className="space-y-1">
                    <p className="text-sm font-medium break-words">{x.supplier}</p>
                    <p className="text-xs text-muted-foreground">{fill(l.yourRep, { rep: x.rep })}</p>
                    {canAct && <AutoConfirmToggle l={l} vendorCompanyId={x.vendorCompanyId} on={x.autoConfirm} allowed={v.allowAutoConfirm} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
