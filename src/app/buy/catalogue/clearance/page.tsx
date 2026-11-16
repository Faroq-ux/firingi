import Link from "next/link";
import { Flame, Timer } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { digestOn, liveDeals, myBids, myWatches } from "@/server/deals/service";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BuyDeal, DigestSwitch, EndsIn, UnwatchRow, WatchButton } from "@/components/deals/client";
import { toBuyerDeal } from "@/components/deals/banner";
import { dealLabels, fill, termsText } from "@/components/deals/labels";
import { DEAL_KINDS } from "@/lib/deals";

export const metadata = { title: "Clearance deals" };
export const dynamic = "force-dynamic";

export default async function ClearancePage({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.catalogue.view", "buyer.orders.place"]);
  const sp = await searchParams;
  const [{ l, locale }, deals, watches, bids, digest] = await Promise.all([dealLabels(), liveDeals(ctx, { q: sp.q ?? null }), myWatches(ctx), myBids(ctx), digestOn(ctx.user.id)]);
  const kind = DEAL_KINDS.includes(sp.kind as never) ? sp.kind : null;
  const shown = kind ? deals.filter((d) => d.kind === kind) : deals;
  const money = (n: number | string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(n));
  const date = (d: Date | string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d));
  const watched = new Set(watches.map((w) => `${w.kind}:${w.targetId}`));
  const canBuy = ctx.permissions.has("buyer.orders.place");
  return (
    <>
      <PageHeader title={l.title} icon={Flame} description={l.intro} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="deal-filters">
        <Link href="/buy/catalogue/clearance" className={`rounded-full border px-3 py-1 ${!kind ? "bg-secondary font-medium" : "hover:bg-accent"}`}>{l.all}</Link>
        {DEAL_KINDS.map((k) => <Link key={k} href={`/buy/catalogue/clearance?kind=${k}`} className={`rounded-full border px-3 py-1 ${kind === k ? "bg-secondary font-medium" : "hover:bg-accent"}`}>{l[`kind.${k}`]}</Link>)}
        <form className="ml-auto flex gap-2" action="/buy/catalogue/clearance"><input name="q" defaultValue={sp.q ?? ""} placeholder={l.search} aria-label={l.search} className="h-9 w-48 rounded-md border bg-background px-3" /><button className="h-9 rounded-md border px-3 hover:bg-accent">{l.searchBtn}</button></form>
      </div>

      {!shown.length ? <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="no-deals">{l.none}</CardContent></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="deals">
          {shown.map((d) => {
            const view = toBuyerDeal(d);
            return (
              <div key={d.id} className="glass-panel flex flex-col gap-3 rounded-2xl border p-4" data-testid="deal-card" data-kind={d.kind}>
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant="secondary">{l[`kind.${d.kind}`]}</Badge>
                  {d.pct != null && <Badge variant="destructive" data-testid="deal-pct">−{Math.round(d.pct)} %</Badge>}
                  {d.clearance && <Badge variant="warning">{l.clearance}</Badge>}
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"><Timer className="size-3.5" /><EndsIn l={l} endsAt={d.endsAt.toISOString()} /></span>
                </div>
                <div className="min-w-0">
                  <Link href={`/buy/catalogue/offers/${d.offer.offerId}`} className="font-semibold leading-snug hover:text-primary">{d.title || pickLocalized(d.offer.name, locale)}</Link>
                  <p className="text-xs text-muted-foreground">{pickLocalized(d.offer.packaging.name, locale)} · {d.offer.vendor.name}</p>
                </div>
                <div className="flex flex-wrap items-baseline gap-2">
                  {d.bestUnit != null ? <><span className="text-2xl font-bold tabular-nums" data-testid="deal-price">{money(d.bestUnit)}</span><span className="text-sm text-muted-foreground line-through">{money(d.listUnit)}</span></> : <span className="text-sm">{fill(l.listNow, { price: money(d.listUnit) })}</span>}
                  <span className="text-xs text-muted-foreground">{l.exVat}</span>
                </div>
                <p className="text-sm" data-testid="deal-terms">{termsText(l, d.terms, locale)}</p>
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {d.left != null && <li className="rounded-full border px-2 py-0.5" data-testid="deal-left">{fill(l.left, { n: d.left })}</li>}
                  {d.perBuyerMax != null && <li className="rounded-full border px-2 py-0.5">{fill(l.perBuyer, { n: d.perBuyerMax })}</li>}
                  {d.bestBefore && <li className="rounded-full border px-2 py-0.5">{fill(l.bestBefore, { date: date(d.bestBefore) })}</li>}
                  {d.note && <li className="rounded-full border px-2 py-0.5">{d.note}</li>}
                </ul>
                <div className="mt-auto space-y-2 border-t pt-3">
                  {canBuy && <BuyDeal l={l} d={view} locale={locale} />}
                  <div className="flex flex-wrap gap-1.5">
                    <WatchButton l={l} kind="PRODUCT" id={d.offer.productId} on={watched.has(`PRODUCT:${d.offer.productId}`)} label={l.thisProduct} />
                    <WatchButton l={l} kind="SUPPLIER" id={d.offer.vendor.id} on={watched.has(`SUPPLIER:${d.offer.vendor.id}`)} label={d.offer.vendor.name} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.alertsTitle}</CardTitle><CardDescription>{l.alertsHint}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <DigestSwitch l={l} on={digest} />
            {watches.length ? (
              <ul className="divide-y text-sm" data-testid="watchlist">
                {watches.map((w) => <li key={w.id} className="flex items-center gap-2 py-1.5"><Badge variant="outline">{l[`watchKind.${w.kind}`]}</Badge><span className="min-w-0 flex-1 truncate">{w.supplier ?? (w.name ? pickLocalized(w.name, locale) : "—")}</span><UnwatchRow l={l} kind={w.kind} id={w.targetId} /></li>)}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{l.noWatches}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.myOffers}</CardTitle></CardHeader>
          <CardContent>
            {bids.length ? (
              <ul className="divide-y text-sm" data-testid="my-bids">
                {bids.map((b) => <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"><span className="min-w-0 flex-1 truncate">{pickLocalized(b.deal.offer.packaging.variant.product.name, locale)}</span><span className="tabular-nums">{b.qty} × {money(Number(b.counterPrice ?? b.unitPrice))}</span><Badge variant={b.status === "ACCEPTED" || b.status === "ORDERED" ? "success" : b.status === "REJECTED" || b.status === "EXPIRED" ? "outline" : "warning"}>{l[`bidStatus.${b.status}`]}</Badge></li>)}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{l.noOffers}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
