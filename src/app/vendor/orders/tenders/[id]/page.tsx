import Link from "next/link";
import { notFound } from "next/navigation";
import { Gavel } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierTender } from "@/server/tenders/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fill, statusTone, tenderLabels } from "@/components/tenders/labels";
import { BidForm } from "@/components/tenders/client";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Tender" };
export const dynamic = "force-dynamic";

export default async function VendorTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.orders.manage"]);
  const { id } = await params;
  const [{ l, locale }, d] = await Promise.all([tenderLabels(), supplierTender(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; })]);
  const t = d.tender, money = (n: number) => formatMoney(n, locale);
  return (
    <>
      <PageHeader title={t.title} icon={Gavel} eyebrow={t.number} description={t.note ?? undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/vendor/orders/tenders" className="text-primary hover:underline">← {l.vTitle}</Link>
        <Badge variant={statusTone(t.status)} data-testid="td-status">{l[`status.${t.status}`]}</Badge>
        {d.bid && <Badge variant={statusTone(d.bid.status)} data-testid="td-my-bid">{l[`bidStatus.${d.bid.status}`]}</Badge>}
        <span className="text-muted-foreground">{t.buyer}{t.place ? ` · ${t.place}` : ""} · {d.open ? fill(l.closesOn, { date: formatDate(t.closesAt, locale, true) }) : fill(l.closedOn, { date: formatDate(t.closesAt, locale, true) })}{t.deliveryDate ? ` · ${fill(l.deliveryOn, { date: formatDate(t.deliveryDate, locale) })}` : ""}</span>
      </div>
      <Card>
        <CardHeader><CardTitle>{d.open ? (d.bid ? l.yourBid : l.makeBid) : l.yourBid}</CardTitle><CardDescription>{d.open ? l.bidIntro : l.biddingClosed}</CardDescription></CardHeader>
        <CardContent>
          {d.open ? <BidForm l={l} tenderId={t.id} lines={d.lines} offers={d.offers} commissionPct={d.commissionPct} locale={locale} hasBid={d.bid?.status === "SUBMITTED"} note={d.bid?.note ?? null} /> : (
            <ul className="divide-y text-sm" data-testid="td-v-result">
              {d.lines.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 basis-full break-words sm:basis-auto sm:flex-1">{x.n}. {x.description} <span className="text-muted-foreground">× {x.qty}</span></span>
                  {x.mine ? <span className="text-xs">{money(x.mine.unitNet)} · {x.won ? <b className="text-success">{l.lineWon}</b> : t.status === "AWARDED" ? l.lineLost : l.waiting}</span> : <span className="text-xs text-muted-foreground">{l.noBidLine}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
