import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { preAccess } from "@/server/preorders/settings";
import { campaignDetail, vendorOfferOptions } from "@/server/preorders/campaigns";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { preLabels } from "@/components/preorders/labels";
import { CampaignActions, CampaignForm, type CampaignInit } from "@/components/preorders/vendor";
import { ALLOCATION_RULES, CAMPAIGN_KINDS } from "@/lib/preorders";

export const metadata = { title: "Pre-order" };
export const dynamic = "force-dynamic";
const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Phase 71: a supplier's pre-order — editor while a draft, then demand, plan per delivery date and the buyers' pre-orders. */
export default async function VendorCampaign({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage", "vendor.pricing.manage", "vendor.orders.view", "vendor.orders.manage"]);
  const a = await preAccess(ctx.company);
  if (!a.sellerCampaigns) notFound();
  const { id } = await params;
  const { l, locale } = await preLabels();
  const manage = can(ctx, ["vendor.promotions.manage", "vendor.pricing.manage"]);
  const isNew = id === "new";
  const d = isNew ? null : await campaignDetail(ctx, id, locale).catch(() => null);
  if (!isNew && !d) notFound();
  const eur = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const day = (x: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(x);
  const kinds = CAMPAIGN_KINDS.filter((k) => a.s.kinds[k]).map((k) => ({ value: k, label: l[`kind.${k}`] }));
  const allocs = ALLOCATION_RULES.map((k) => ({ value: k, label: l[`alloc.${k}`] }));
  const now = new Date();
  const init: CampaignInit = d ? {
    kind: d.campaign.kind, title: d.campaign.title, description: d.campaign.description ?? "", opensAt: local(d.campaign.opensAt), closesAt: local(d.campaign.closesAt),
    deliveryDates: d.campaign.deliveryDates.map((x) => x.toISOString().slice(0, 10)), allocation: d.campaign.allocation, depositPct: String(d.campaign.depositPct),
    items: d.items.map((i) => ({ offerId: i.offerId, unitNet: String(i.unitNet), minQty: String(i.minQty), maxQty: i.maxQty ? String(i.maxQty) : "", supplyQty: i.supplyQty ? String(i.supplyQty) : "", tiers: i.tiers.map((t) => ({ minTotal: String(t.minTotal), unitNet: String(t.unitNet) })) })),
  } : {
    kind: kinds[0]?.value ?? "SEASONAL", title: "", description: "", opensAt: local(now), closesAt: local(new Date(now.getTime() + 14 * 86400_000)),
    deliveryDates: [new Date(now.getTime() + 21 * 86400_000).toISOString().slice(0, 10)], allocation: "PRO_RATA", depositPct: "0",
    items: [{ offerId: "", unitNet: "", minQty: "1", maxQty: "", supplyQty: "", tiers: [] }],
  };
  const editable = isNew || d!.editable;
  const offers = manage && editable ? await vendorOfferOptions(ctx, locale) : [];
  return (
    <>
      <PageHeader title={d ? d.campaign.title : l.sellerNewCampaign} icon={CalendarClock} eyebrow={d?.campaign.number}
        description={d ? <span className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{l[`kind.${d.campaign.kind}`]}</Badge><Badge data-testid="vc-status">{l[`status.${d.campaign.status}`]}</Badge><span>{l.opensLabel} {day(d.campaign.opensAt)} · {l.closesLabel} {day(d.campaign.closesAt)} · {l.deliveries}: {d.campaign.deliveryDates.map(day).join(", ")}</span></span> : undefined}
        actions={<Link className="text-sm text-primary underline" href="/vendor/orders/preorders">{l.sellerTitle}</Link>} />
      <div className="space-y-6">
        {d?.campaign.reviewNote && <p className="text-sm text-muted-foreground">{fill(l.sellerReviewNote, { note: d.campaign.reviewNote })}</p>}
        {d?.campaign.cancelReason && <p className="text-sm text-muted-foreground">{fill(l.reason, { reason: d.campaign.cancelReason })}</p>}
        {d && manage && <CampaignActions l={l} id={d.campaign.id} status={d.campaign.status} auto={a.s.approval === "AUTO"} dates={d.campaign.deliveryDates.map((x) => ({ value: x.toISOString().slice(0, 10), label: day(x) }))} />}
        {editable && manage && <Card><CardContent className="pt-6"><CampaignForm l={l} id={d?.campaign.id ?? null} offers={offers} init={init} kinds={kinds} allocs={allocs} maxDeposit={a.s.maxDepositPct} deposits={a.s.parts.deposits} /></CardContent></Card>}
        {d && !editable && (
          <>
            <Card>
              <CardHeader><CardTitle>{l.sellerProducts}</CardTitle><CardDescription>{l.value}: <b data-testid="vc-value">{eur(d.value)}</b> · {fill(l.allocRule, { rule: l[`alloc.${d.campaign.allocation}`] })}{d.campaign.depositPct ? ` · ${fill(l.deposit, { pct: d.campaign.depositPct })}` : ""}</CardDescription></CardHeader>
              <CardContent className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-medium">{l.product}</th><th className="px-2 py-1 text-right font-medium">{l.total}</th><th className="px-2 py-1 text-right font-medium">{l.sellerSupply}</th><th className="px-2 py-1 text-right font-medium">{l.priceNow}</th><th className="py-1 pl-2 font-medium">{l.tierLabel}</th></tr></thead>
                <tbody>{d.items.map((i) => (
                  <tr key={i.id} className="border-t align-top" data-testid="vc-item">
                    <td className="py-1 pr-2">{i.product} <span className="text-xs text-muted-foreground">{i.pack}</span></td>
                    <td className="px-2 py-1 text-right tabular-nums" data-testid="vc-total">{i.total}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{i.supplyQty ?? "∞"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{eur(i.price)}</td>
                    <td className="py-1 pl-2 text-xs">{i.tiers.length ? i.tiers.map((t) => fill(l.tierRow, { min: t.minTotal, price: eur(t.unitNet) })).join(" · ") : l.none}{i.next ? <span className="block text-[color:var(--success,#16a34a)]">{fill(l.nextTier, { missing: i.next.missing, price: eur(i.next.unitNet) })}</span> : null}</td>
                  </tr>
                ))}</tbody>
              </table></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{l.sellerPlan}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto" data-testid="vc-plan"><table className="w-full text-sm tabular-nums">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-medium">{l.product}</th>{d.plan.map((p) => <th key={p.date.toISOString()} className="px-2 py-1 text-right font-medium">{day(p.date)}</th>)}</tr></thead>
                <tbody>{d.items.map((i) => <tr key={i.id} className="border-t"><td className="py-1 pr-2">{i.product}</td>{d.plan.map((p) => <td key={p.date.toISOString()} className="px-2 py-1 text-right">{p.items.find((x) => x.itemId === i.id)?.qty || "·"}</td>)}</tr>)}</tbody>
              </table></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{l.sellerReservations}</CardTitle></CardHeader>
              <CardContent>{!d.reservations.length ? <p className="text-sm text-muted-foreground">{l.none}</p> : (
                <ul className="divide-y">{d.reservations.map((r) => (
                  <li key={r.id} className="space-y-1 py-2 text-sm" data-testid="vc-res" data-status={r.status}>
                    <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 basis-56 break-words font-medium">{r.buyer} <span className="text-xs font-normal text-muted-foreground">{r.number}</span></span><Badge variant="secondary">{l[`resStatus.${r.status}`]}</Badge><span className="text-xs text-muted-foreground">{l.deliveryDate}: {day(r.deliveryDate)}</span></div>
                    <p className="text-xs text-muted-foreground">{r.lines.map((x) => `${x.product}: ${x.allocatedQty ?? x.qty}${x.allocatedQty != null && x.allocatedQty !== x.qty ? `/${x.qty}` : ""}`).join(" · ")}{r.deposit.amount > 0 ? ` · ${l.depositLabel}: ${eur(r.deposit.amount)} ${r.deposit.paid ? "✓" : ""}` : ""}</p>
                    {r.failReason && <p className="text-xs text-destructive">{fill(l.failed, { reason: r.failReason })}</p>}
                  </li>
                ))}</ul>
              )}</CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
