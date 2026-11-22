import Link from "next/link";
import { notFound } from "next/navigation";
import { Contact, Phone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { customerCard, myRep, salesRepSettings } from "@/server/salesreps/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CancelRepOrder, CheckInButton, OrderTaker } from "@/components/salesreps/client";
import { VisitBadge } from "@/components/salesreps/views";
import { fill, srLabels } from "@/components/salesreps/labels";
import { formatDate, formatMoney } from "@/lib/utils";

import { getTranslations } from "next-intl/server";

export const metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

export default async function RepCustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ visit?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reps.field");
  const [{ id }, { visit }] = await Promise.all([params, searchParams]);
  const { l, locale } = await srLabels();
  if (!(await myRep(ctx))?.active) notFound();
  const c = await customerCard(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [s, ts] = await Promise.all([salesRepSettings(), getTranslations("orders.statuses")]);
  const m = (n: number) => formatMoney(n, locale);
  return (
    <>
      <PageHeader title={c.customer.name} description={l.cardIntro} icon={Contact} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="rc-head">
        <span className="min-w-0 flex-1 basis-60 text-muted-foreground break-words">{[c.customer.address, c.customer.days == null ? l.noOrdersYet : fill(l.daysSince, { n: c.customer.days }), c.customer.openOrders ? fill(l.openOrders, { n: c.customer.openOrders }) : null].filter(Boolean).join(" · ")}</span>
        {c.customer.phone && <a href={`tel:${c.customer.phone}`} className={buttonVariants({ variant: "outline", size: "sm" })}><Phone className="size-4" /> {l.call}</a>}
        {s.enabled && <CheckInButton l={l} buyerCompanyId={c.customer.id} variant="outline" />}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader><CardTitle>{l.newOrder}</CardTitle></CardHeader>
          <CardContent>
            {!s.enabled ? <p className="text-sm">{l.off}</p> : !c.addresses.length ? <p className="text-sm text-muted-foreground">—</p> : (
              <OrderTaker l={l} locale={locale} buyerCompanyId={c.customer.id} addresses={c.addresses} usual={c.usual} auto={c.autoConfirm} confirmHours={s.confirmHours} visitId={visit ?? null} />
            )}
          </CardContent>
        </Card>
        <div className="space-y-6">
          {c.pending.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">{l.pendingTitle}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y" data-testid="rc-pending">
                  {c.pending.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1">{m(p.totalNet)} · {fill(l.lines, { n: p.lines })}<br /><span className="text-xs text-muted-foreground">{fill(l.expires, { date: formatDate(p.expiresAt, locale, true) })}</span></span>
                      <CancelRepOrder l={l} id={p.id} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">{l.recentOrders}</CardTitle></CardHeader>
            <CardContent>
              {!c.orders.length ? <p className="text-sm text-muted-foreground">{l.noOrdersYet}</p> : (
                <ul className="divide-y text-sm" data-testid="rc-orders">
                  {c.orders.map((o) => <li key={o.id} className="flex flex-wrap gap-2 py-2"><Link href={`/vendor/orders/${o.id}`} className="font-mono hover:underline">{o.number}</Link><span className="text-muted-foreground">{formatDate(o.placedAt, locale)}</span><span className="ml-auto tabular-nums">{m(o.net)}</span><Badge variant="secondary">{ts(o.status)}</Badge></li>)}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">{l.recentVisits}</CardTitle><CardDescription>{c.visits.length ? "" : l.noVisits}</CardDescription></CardHeader>
            {c.visits.length > 0 && (
              <CardContent>
                <ul className="space-y-2 text-sm" data-testid="rc-visits">
                  {c.visits.map((v) => <li key={v.id} className="flex flex-wrap items-center gap-2"><span className="tabular-nums">{formatDate(v.date, locale)}</span><VisitBadge l={l} status={v.status} />{v.outcome && <span className="text-xs text-muted-foreground">{l[`outcome.${v.outcome}`]}</span>}{v.note && <span className="w-full break-words text-muted-foreground">{v.note}</span>}</li>)}
                </ul>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
