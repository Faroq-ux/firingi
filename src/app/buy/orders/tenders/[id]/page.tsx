import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Gavel } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { buyerTender } from "@/server/tenders/service";
import { checkoutOptions } from "@/server/pay-later/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fill, statusTone, tenderLabels } from "@/components/tenders/labels";
import { AwardForm, TenderButtons } from "@/components/tenders/client";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Tender" };
export const dynamic = "force-dynamic";

export default async function BuyerTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const { id } = await params;
  const [{ l, locale }, d] = await Promise.all([tenderLabels(), buyerTender(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; })]);
  const t = d.tender, money = (n: number) => formatMoney(n, locale);
  const canPlace = ctx.permissions.has("buyer.orders.place");
  let payLater: { id: string; label: string }[] | null = null;
  if (d.canAward && canPlace && d.settings.payLater) {
    const best = d.lines.reduce((a, x) => a + (x.bids[0]?.total ?? 0), 0) * 1.23;
    const o = await checkoutOptions(ctx, best).catch(() => null);
    if (o?.available) { const tp = await getTranslations("payLater"); payLater = o.terms.map((x) => ({ id: x.id, label: x.kind === "DAYS" ? tp("termDays", { days: x.days }) : tp("termInstalments", { count: x.count }) })); }
  }
  return (
    <>
      <PageHeader title={t.title} icon={Gavel} eyebrow={t.number} description={t.note ?? undefined}
        actions={canPlace && ["PENDING", "OPEN", "CLOSED"].includes(t.status) ? <TenderButtons l={l} id={t.id} open={t.status === "OPEN"} /> : null} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/buy/orders/tenders" className="text-primary hover:underline">← {l.title}</Link>
        <Badge variant={statusTone(t.status)} data-testid="td-status">{l[`status.${t.status}`]}</Badge>
        <span className="text-muted-foreground">{t.status === "OPEN" ? fill(l.closesOn, { date: formatDate(t.closesAt, locale, true) }) : fill(l.closedOn, { date: formatDate(t.closesAt, locale, true) })}{t.deliveryDate ? ` · ${fill(l.deliveryOn, { date: formatDate(t.deliveryDate, locale) })}` : ""} · {fill(l.suppliersBid, { n: d.suppliers })}</span>
        {t.invited.length > 0 && <span className="basis-full text-xs text-muted-foreground">{l.invitedOnly}: {t.invited.join(", ")}</span>}
        {t.reviewNote && <span className="basis-full text-xs text-muted-foreground">{fill(l.firingiNote, { note: t.reviewNote })}</span>}
      </div>
      {d.canAward && canPlace ? (
        <Card>
          <CardHeader><CardTitle>{l.bidsTitle}</CardTitle><CardDescription>{t.status === "OPEN" ? l.awardEarly : l.awardIntro}</CardDescription></CardHeader>
          <CardContent><AwardForm l={l} id={t.id} locale={locale} lines={d.lines} payLater={payLater} /></CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>{l.linesTitle}</CardTitle>{t.status === "OPEN" && <CardDescription>{l.waitingBids}</CardDescription>}</CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="td-lines">
              {d.lines.map((x) => {
                const won = x.bids.find((b) => b.bidLineId === x.awardedBidLineId);
                return (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="td-line-row">
                    <span className="min-w-0 basis-full break-words sm:basis-auto sm:flex-1">{x.n}. {x.description} <span className="text-muted-foreground">× {x.qty}{x.unitNote ? ` (${x.unitNote})` : ""}</span></span>
                    {won ? <span className="text-xs">{won.supplier} · {money(won.unitNet)}{x.order && <> · <Link href={`/buy/orders/${x.order.id}`} className="text-primary hover:underline" data-testid="td-order">{x.order.number}</Link></>}</span> : <span className="text-xs text-muted-foreground">{fill(l.bidsN, { n: x.bids.length })}</span>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
