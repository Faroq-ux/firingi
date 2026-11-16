import { Flame } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { dealSettings, vendorDealOffers, vendorDeals } from "@/server/deals/service";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnswerBid, CancelDeal, NewDealForm } from "@/components/deals/client";
import { dealLabels, fill, termsText } from "@/components/deals/labels";
import { DEAL_KINDS } from "@/lib/deals";

export const metadata = { title: "Deals" };
export const dynamic = "force-dynamic";

const TONE = { DRAFT: "outline", PENDING: "warning", APPROVED: "success", REJECTED: "destructive", ENDED: "outline", CANCELLED: "outline", SOLD_OUT: "secondary" } as const;

export default async function VendorDealsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage", "vendor.pricing.manage"]);
  const [{ l, locale }, deals, offers, s] = await Promise.all([dealLabels(), vendorDeals(ctx), vendorDealOffers(ctx), dealSettings()]);
  const money = (n: unknown) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(n));
  const when = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(d);
  const kinds = DEAL_KINDS.filter((k) => s.kinds[k]);
  const now = new Date();
  const statusOf = (d: (typeof deals)[number]) => (d.status === "APPROVED" ? (d.startsAt > now ? "SCHEDULED" : d.endsAt <= now ? "ENDED" : "LIVE") : d.status);
  return (
    <>
      <PageHeader title={l.vendorTitle} icon={Flame} description={l.vendorIntro} />
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.newDeal}</CardTitle><CardDescription>{s.approval.mode === "ALWAYS" ? l.approvalAlways : fill(l.approvalAuto, { pct: s.approval.maxDiscountPct, days: s.approval.maxDays })}</CardDescription></CardHeader>
        <CardContent>
          {kinds.length ? <NewDealForm l={l} locale={locale} minPct={s.minDiscountPct} kinds={kinds} offers={offers.map((o) => ({ id: o.id, label: `${pickLocalized(o.name, locale)} · ${pickLocalized(o.packaging, locale)} (${o.sku})` }))} /> : <p className="text-sm text-muted-foreground">{l.noKinds}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{l.yourDeals}</CardTitle></CardHeader>
        <CardContent>
          {!deals.length ? <p className="py-6 text-center text-sm text-muted-foreground">{l.noDealsYet}</p> : (
            <ul className="divide-y" data-testid="vendor-deals">
              {deals.map((d) => {
                const st = statusOf(d);
                return (
                  <li key={d.id} className="space-y-2 py-3 text-sm" data-testid="vendor-deal" data-status={d.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{d.number}</span>
                      <span className="font-medium">{d.title || pickLocalized(d.offer.packaging.variant.product.name, locale)}</span>
                      <Badge variant="secondary">{l[`kind.${d.kind}`]}</Badge>
                      <Badge variant={st === "LIVE" ? "success" : st === "SCHEDULED" ? "secondary" : TONE[d.status]}>{l[`status.${st}`]}</Badge>
                      {d.clearance && <Badge variant="warning">{l.clearance}</Badge>}
                      {d.autoApproved && <span className="text-xs text-muted-foreground">{l.autoApproved}</span>}
                    </div>
                    <p className="break-words">{termsText(l, d, locale, { supplier: true })}{d.discountPct != null ? ` · −${Number(d.discountPct).toFixed(0)} %` : ""}</p>
                    <p className="text-xs text-muted-foreground">{when(d.startsAt)} → {when(d.endsAt)} · {fill(l.soldOf, { sold: d.sold, max: d.maxQty ?? "∞" })} · {fill(l.revenue, { amount: money(d.revenue) })}{d.commissionPct != null ? ` · ${fill(l.dealCommission, { pct: Number(d.commissionPct) })}` : ""}</p>
                    {d.reviewNote && <p className="text-xs">{fill(l.firingiNote, { note: d.reviewNote })}</p>}
                    {d.bids.length > 0 && (
                      <ul className="space-y-1.5 rounded-lg border p-2" data-testid="deal-bids">
                        {d.bids.map((b) => (
                          <li key={b.id} className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1">{b.buyer.tradeName ?? b.buyer.legalName}: {b.qty} × {money(b.unitPrice)}{b.counterPrice ? ` → ${money(b.counterPrice)}` : ""}{b.message ? ` — “${b.message}”` : ""}</span>
                            {b.status === "PENDING" ? <AnswerBid l={l} bidId={b.id} mine={Number(b.unitPrice)} list={Number(d.listPriceAt ?? 0)} /> : <Badge variant="outline">{l[`bidStatus.${b.status}`]}</Badge>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {["DRAFT", "PENDING", "APPROVED"].includes(d.status) && st !== "ENDED" && <CancelDeal l={l} id={d.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
