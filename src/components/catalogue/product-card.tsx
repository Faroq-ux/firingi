import Link from "next/link";
import { CardStars } from "@/components/reviews/views";
import { getLocale, getTranslations } from "next-intl/server";
import { Package } from "lucide-react";
import type { CatalogueItem } from "@/server/data/catalogue-buyer";
import { co2Badges } from "@/server/co2/service";
import { Co2Chips } from "@/components/co2/views";
import { co2Labels, kgText } from "@/components/co2/labels";
import { pickLocalized } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { PriceBlock, Codes } from "./price";
import { VerifiedBadges } from "@/components/compliance/badges";
import { offerReturnables } from "@/server/returnables/service";
import { ProductReturnables } from "@/components/returnables/views";
import { rtLabels } from "@/components/returnables/labels";
import { offerCatchWeight } from "@/server/catchweight/service";
import { CwBadge } from "@/components/catchweight/views";
import { cwLabels } from "@/components/catchweight/labels";
import { offerColdBadges } from "@/server/coldchain/service";
import { ColdBadge } from "@/components/coldchain/views";
import { getContext } from "@/server/context";
import { offerBadges as exciseBadges } from "@/server/excise/service";
import { ExciseBadge } from "@/components/excise/views";
import { exLabels } from "@/components/excise/labels";
import { foodBadges } from "@/server/food/service";
import { FoodCardBadges } from "@/components/food/views";
import { foodLabels } from "@/components/food/labels";

export async function StockBadge({ status }: { status: CatalogueItem["stockStatus"] }) {
  const t = await getTranslations("catalogue");
  return status === "IN" ? <Badge variant="success">{t("inStock")}</Badge> : status === "LOW" ? <Badge variant="warning">{t("lowStock")}</Badge> : <Badge variant="destructive">{t("outOfStock")}</Badge>;
}

export function ProductThumb({ productId, hasImage, className = "" }: { productId: string; hasImage: boolean; className?: string }) {
  return hasImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/catalogue/images/${productId}/0`} alt="" className={`object-contain ${className}`} />
  ) : (
    <div className={`grid place-items-center bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklch,var(--vivid-blue)_18%,transparent),transparent_60%),radial-gradient(circle_at_80%_90%,color-mix(in_oklch,var(--vivid-violet)_16%,transparent),transparent_60%)] text-[color:color-mix(in_oklch,var(--vivid-violet)_60%,var(--muted-foreground))] ${className}`}><Package className="size-9 motion-float" /></div>
  );
}

/** `sponsored` (Phase 34): the "Sponsored" label and a link through the ad click counter. `deal` (Phase 38): a live clearance deal on this offer. */
export async function ProductCard({ item, hasImage, showVendor = true, sponsored, deal }: { item: CatalogueItem; hasImage: boolean; showVendor?: boolean; sponsored?: { href: string; label: string }; deal?: { pct: number | null; endsAt: Date; kind: string } }) {
  const [t, td, locale] = await Promise.all([getTranslations("catalogue"), getTranslations("deals"), getLocale()]);
  // Phase 40: "+ deposit" / "refill" when the product comes with returnables
  const rt = (await offerReturnables([item.offerId], locale))[item.offerId] ?? [];
  const rl = rt.length ? (await rtLabels()).l : null;
  // Phase 41: "By weight · 6,75 €/kg"
  const cw = (await offerCatchWeight([item.offerId])).get(item.offerId) ?? null;
  const cl = cw ? (await cwLabels()).l : null;
  const cold = (await offerColdBadges([item.offerId], locale)).get(item.offerId) ?? null; // Phase 42
  const cctx = await getContext();
  const ex = cctx ? (await exciseBadges(cctx, [{ offerId: item.offerId, unitPriceNet: item.price ? Number(item.price.unitPriceNet) : null }], locale)).get(item.offerId) ?? null : null; // Phase 43
  const exl = ex ? (await exLabels()).l : null;
  const fb = cctx ? (await foodBadges(cctx, [item.productId])).get(item.productId) ?? null : null; // Phase 44
  const fl = fb && (fb.contain.length || fb.diets.length || fb.hits.length) ? (await foodLabels()).l : null;
  const co2 = cctx ? (await co2Badges(cctx, [item.offerId])).get(item.offerId) ?? null : null; // Phase 51
  const c2 = co2 ? await co2Labels() : null;
  return (
    <Link href={sponsored?.href ?? `/buy/catalogue/offers/${item.offerId}`} prefetch={sponsored ? false : undefined} data-testid={sponsored ? "sponsored-card" : undefined} className="glass-panel group flex flex-col overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_44px_-24px_color-mix(in_oklch,var(--vivid-violet)_80%,transparent)]">
      <div className="relative overflow-hidden bg-[linear-gradient(160deg,color-mix(in_oklch,var(--vivid-blue)_8%,var(--card)),var(--card))]">
        <ProductThumb productId={item.productId} hasImage={hasImage} className="h-36 w-full transition-transform duration-500 group-hover:scale-105" />
        {sponsored && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur" data-testid="sponsored-label">{sponsored.label}</span>}
        {deal && <span className="absolute right-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white shadow" data-testid="deal-badge">{deal.pct != null && deal.pct >= 1 ? `−${Math.round(deal.pct)} %` : td(`kind.${deal.kind}`)} · {td("badge")}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="text-xs text-muted-foreground">{item.brand ?? pickLocalized(item.category.name, locale)}</div>
        <div className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">{pickLocalized(item.name, locale)}</div>
        <div className="text-xs text-muted-foreground">{pickLocalized(item.packaging.name, locale)}</div>
        {cold && <div><ColdBadge cls={cold} /></div>}
        {ex && exl && <div><ExciseBadge b={ex} l={exl} locale={locale} /></div>}
        {co2 && c2 && (co2.badges.length > 0 || co2.kg > 0) && <Co2Chips badges={co2.badges} l={c2.l} kgText={co2.kg > 0 ? `${kgText(co2.kg, c2.locale)} / ${c2.l.perPack}` : null} />}
        {fb && fl && <FoodCardBadges food={{ ...item.food, contain: fb.contain, diets: fb.diets }} hits={fb.hits} l={fl} />}
        <CardStars productId={item.productId} sellerId={item.vendor.id || null} />
        <Codes item={item} />
        <div className="mt-auto pt-2">
          <PriceBlock item={item} />
          {item.price && item.price.scope !== "BASE" && <Badge className="mt-1">{t(`priceScope.${item.price.scope}`)}</Badge>}
          {cw && cl && <div className="mt-1"><CwBadge l={cl} locale={locale} cw={cw} unitGross={item.price ? Number(item.price.local?.unitPriceGross ?? item.price.unitPriceGross) : null} currency={item.price?.local?.code ?? "EUR"} /></div>}
          {rl && <div className="mt-1"><ProductReturnables l={rl} locale={locale} items={rt} compact /></div>}
          {showVendor && <VerifiedBadges badges={item.vendor.badges} max={2} className="mt-2" />}
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{showVendor ? `${item.vendor.country.flag ?? ""} ${item.vendor.name}` : ""}</span>
            <StockBadge status={item.stockStatus} />
          </div>
        </div>
      </div>
    </Link>
  );
}
