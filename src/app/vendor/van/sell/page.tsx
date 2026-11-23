import Link from "next/link";
import { Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { can } from "@/server/rbac/guard";
import { mySalesToday, myVan, recentVanCustomers, vanEmptyTypes } from "@/server/vansales/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UnloadForm, VanSeller } from "@/components/vansales/client";
import { MethodBadge, SaleBadge } from "@/components/vansales/views";
import { fill, vsLabels } from "@/components/vansales/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Sell from the van" };
export const dynamic = "force-dynamic";

export default async function VanSellPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.vansales.sell", "vendor.vansales.manage"]);
  const [{ l, locale }, van, today] = await Promise.all([vsLabels(), myVan(ctx), mySalesToday(ctx)]);
  const m = (n: number) => formatMoney(n, locale);
  const onRoad = van.on && van.load?.status === "ON_ROAD";
  const [recent, empties] = onRoad ? await Promise.all([recentVanCustomers(ctx), van.settings.allowEmpties ? vanEmptyTypes(ctx) : Promise.resolve([])]) : [[], []];
  return (
    <>
      <PageHeader title={l.sellTitle} description={l.sellIntro} icon={Truck} />
      {!van.on ? <p className="rounded-md bg-muted p-3 text-sm" data-testid="vs-off">{l.off}</p>
        : !van.load ? (
          <div className="space-y-3">
            {van.lastClosed && <p className="rounded-md border p-3 text-sm" role="status" data-testid="vs-last-closed">{fill(l.yourVan, { number: van.lastClosed.number })} · {fill(l.closed, { variance: m(van.lastClosed.variance), missing: van.lastClosed.missing })}</p>}
            <p className="rounded-md bg-muted p-3 text-sm" data-testid="vs-no-van">{l.noVan}</p>
          </div>
        )
        : van.load.status === "OPEN" ? <p className="rounded-md bg-muted p-3 text-sm" data-testid="vs-loading">{fill(l.beingLoaded, { number: van.load.number })}</p>
        : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader><CardTitle data-testid="vs-van" data-number={van.load.number}>{fill(l.yourVan, { number: van.load.number })}</CardTitle></CardHeader>
              <CardContent><VanSeller l={l} locale={locale} userId={ctx.user.id} settings={van.settings} recent={recent} empties={empties} /></CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>{l.stockLeft}</CardTitle></CardHeader>
                <CardContent>
                  <ul className="divide-y text-sm" data-testid="vs-stock">
                    {van.load.products.map((p) => <li key={p.offerId} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging}</span></span><span className="font-medium tabular-nums" data-testid="vs-stock-left">{p.left}</span></li>)}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{l.todaySales}</CardTitle></CardHeader>
                <CardContent>
                  {!today.length ? <p className="text-sm text-muted-foreground">{l.noneToday}</p> : (
                    <ul className="divide-y text-sm" data-testid="vs-today">
                      {today.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="vs-today-row">
                          <span className="min-w-0 flex-1 basis-32 break-words">{s.customer}</span><SaleBadge l={l} status={s.status} /><MethodBadge l={l} method={s.method} /><span className="tabular-nums">{m(s.gross)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      {onRoad && van.load && (
        <Card className="mt-6">
          <CardHeader><CardTitle>{l.endOfDay}</CardTitle></CardHeader>
          <CardContent>
            <UnloadForm key={`${van.load.cashExpected}-${van.load.products.map((p) => p.left).join(".")}`} l={l} locale={locale} loadId={van.load.id} cashExpected={van.load.cashExpected} products={van.load.products.filter((p) => p.left > 0).map((p) => ({ offerId: p.offerId, name: p.name, packaging: p.packaging, left: p.left }))} />
            {can(ctx, "vendor.vansales.manage") && <Link href={`/vendor/van/${van.load.id}`} className="mt-3 inline-block text-sm underline-offset-2 hover:underline">{l.loads}</Link>}
          </CardContent>
        </Card>
      )}
    </>
  );
}
