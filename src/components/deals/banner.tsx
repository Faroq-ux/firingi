/** The live clearance deal on a product page (Phase 38) — and the mapping the deal pages share. */
import { Flame, Timer } from "lucide-react";
import type { liveDeals } from "@/server/deals/service";
import { Badge } from "@/components/ui/badge";
import { BuyDeal, EndsIn, type BuyerDeal } from "@/components/deals/client";
import { fill, termsText } from "@/components/deals/labels";

export type LiveDeal = Awaited<ReturnType<typeof liveDeals>>[number];

export function toBuyerDeal(d: LiveDeal): BuyerDeal {
  return {
    id: d.id, kind: d.kind, offerId: d.offer.offerId, left: d.left, perBuyerMax: d.perBuyerMax, boughtByMe: d.boughtByMe, listUnit: d.listUnit, bestUnit: d.bestUnit,
    minQty: d.offer.minOrderQty, step: d.offer.qtyStep, minBidQty: d.minBidQty, lotQty: d.kind === "LOT" ? d.terms.maxQty ?? null : null, tiers: d.terms.tiers ?? null,
    bundleQty: d.terms.bundleQty ?? null, bundlePrice: d.terms.bundlePrice ?? null,
    bid: d.bid ? { id: d.bid.id, status: d.bid.status, qty: d.bid.qty, unitPrice: Number(d.bid.unitPrice), counterPrice: d.bid.counterPrice == null ? null : Number(d.bid.counterPrice), expiresAt: d.bid.expiresAt.toISOString() } : null,
  };
}

export function DealBanner({ d, l, locale, canBuy }: { d: LiveDeal; l: Record<string, string>; locale: string; canBuy: boolean }) {
  const money = (n: number | string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(n));
  return (
    <div className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4" data-testid="deal-banner" data-kind={d.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Flame className="size-5 text-destructive" />
        <span className="font-semibold">{l[`kind.${d.kind}`]}</span>
        {d.pct != null && <Badge variant="destructive">−{Math.round(d.pct)} %</Badge>}
        {d.clearance && <Badge variant="warning">{l.clearance}</Badge>}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"><Timer className="size-3.5" /><EndsIn l={l} endsAt={d.endsAt.toISOString()} /></span>
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        {d.bestUnit != null && <><span className="text-xl font-bold tabular-nums">{money(d.bestUnit)}</span><span className="text-sm text-muted-foreground line-through">{money(d.listUnit)}</span><span className="text-xs text-muted-foreground">{l.exVat}</span></>}
        <span className="text-sm">{termsText(l, d.terms, locale)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {d.left != null && <span className="rounded-full border px-2 py-0.5">{fill(l.left, { n: d.left })}</span>}
        {d.perBuyerMax != null && <span className="rounded-full border px-2 py-0.5">{fill(l.perBuyer, { n: d.perBuyerMax })}</span>}
        {d.note && <span className="rounded-full border px-2 py-0.5">{d.note}</span>}
      </div>
      {canBuy && <BuyDeal l={l} d={toBuyerDeal(d)} locale={locale} />}
    </div>
  );
}
