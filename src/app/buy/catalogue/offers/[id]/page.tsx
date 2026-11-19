import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { AddToCart } from "@/components/orders/add-to-cart";
import { catalogueItem } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { NotFoundError } from "@/server/errors";
import { bestBeforeFor } from "@/server/inventory/expiry";
import { pickLocalized } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProductThumb, StockBadge } from "@/components/catalogue/product-card";
import { Codes, PriceBlock } from "@/components/catalogue/price";
import { formatMoney } from "@/lib/utils";
import { VerifiedPanel } from "@/components/compliance/badges";
import { liveDeals } from "@/server/deals/service";
import { DealBanner } from "@/components/deals/banner";
import { dealLabels } from "@/components/deals/labels";
import { offerReturnables } from "@/server/returnables/service";
import { ProductReturnables } from "@/components/returnables/views";
import { rtLabels } from "@/components/returnables/labels";
import { offerCatchWeight } from "@/server/catchweight/service";
import { ProductCatchWeight } from "@/components/catchweight/views";
import { cwLabels } from "@/components/catchweight/labels";
import { offerColdBadges } from "@/server/coldchain/service";
import { ColdBadge } from "@/components/coldchain/views";
import { offerBadges as exciseBadges } from "@/server/excise/service";
import { ExciseBadge } from "@/components/excise/views";
import { exLabels } from "@/components/excise/labels";
import { buyerProductFood } from "@/server/food/service";
import { FoodPanel } from "@/components/food/views";
import { foodLabels } from "@/components/food/labels";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { id } = await params;
  const data = await catalogueItem(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const { item, alternatives } = data;
  const [t, ti, locale, images, bestBefore, deals, dl] = await Promise.all([getTranslations("catalogue"), getTranslations("inventory"), getLocale(), productsWithImages([item.productId]), bestBeforeFor([id]), liveDeals(ctx, { offerIds: [id] }).catch(() => []), dealLabels()]);
  const [rt, rl, cwm, cl] = await Promise.all([offerReturnables([id], locale), rtLabels(), offerCatchWeight([id]), cwLabels()]);
  const cw = cwm.get(id) ?? null; // Phase 41: sold by weight
  const cold = (await offerColdBadges([id], locale)).get(id) ?? null; // Phase 42: chilled / frozen
  const ex = (await exciseBadges(ctx, [{ offerId: id, unitPriceNet: item.price ? Number(item.price.unitPriceNet) : null }], locale)).get(id) ?? null; // Phase 43: licensed / excise goods
  const exl = ex ? (await exLabels()).l : null;
  const food = await buyerProductFood(ctx, item.productId, locale).catch(() => null); // Phase 44: allergens, ingredients, nutrition
  const fl = food ? (await foodLabels()).l : null;
  const bb = bestBefore.get(id) ?? null; // only when the supplier shows best-before (FIRINGI decides) and it is close
  const name = pickLocalized(item.name, locale);

  return (
    <>
      {item.vendor.id
        ? <Link href={`/buy/catalogue/suppliers/${item.vendor.id}`} className="text-sm text-primary hover:underline">← {t("backToStore", { name: item.vendor.name })}</Link>
        : <Link href="/buy/catalogue/browse" className="text-sm text-primary hover:underline">← {t("shop")}</Link>}
      <div className="mt-4 grid gap-6 md:grid-cols-[18rem_1fr]">
        <ProductThumb productId={item.productId} hasImage={images.has(item.productId)} className="h-64 w-full rounded-xl border" />
        <div className="space-y-4">
          <div>
            <div className="text-sm text-muted-foreground">{item.brand ?? ""} {item.brand ? "·" : ""} {pickLocalized(item.category.name, locale)}</div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{pickLocalized(item.packaging.name, locale)}</Badge>
              {cold && <ColdBadge cls={cold} />}
              {ex && exl && <ExciseBadge b={ex} l={exl} locale={locale} full />}
              {bb && <Badge variant="warning" data-testid="best-before">{ti("bestBeforeDate", { date: new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(bb) })}</Badge>}

              {item.restriction && <Badge variant="warning">{t(`restricted.${item.restriction}`)}</Badge>}
            </div>
            <div className="mt-2"><Codes item={item} full /></div>
          </div>
          {deals.map((d) => <DealBanner key={d.id} d={d} l={dl.l} locale={locale} canBuy={can(ctx, "buyer.orders.place")} />)}
          <ProductReturnables l={rl.l} locale={locale} items={rt[id] ?? []} />
          {cw && <ProductCatchWeight l={cl.l} locale={locale} cw={cw} unitGross={item.price ? Number(item.price.local?.unitPriceGross ?? item.price.unitPriceGross) : null} unitNet={item.price ? Number(item.price.local?.unitPriceNet ?? item.price.unitPriceNet) : null} taxLabel={item.taxLabel} currency={item.price?.local?.code ?? "EUR"} />}
          <Card>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start gap-3">
                <PriceBlock item={item} size="lg" />
                {item.price && item.price.scope !== "BASE" && <Badge>{t(`priceScope.${item.price.scope}`)}</Badge>}
              </div>
              {item.packaging.unitsPerPack > 1 && <div className="text-sm text-muted-foreground">{t("unitsPerPack", { units: item.packaging.unitsPerPack })}</div>}
              {item.price && item.price.tiers.length > 1 && (
                <div>
                  <div className="mb-1 text-sm font-medium">{t("tiers")}</div>
                  <div className="flex flex-wrap gap-2">
                    {(item.price.local?.tiers ?? item.price.tiers).map((tier) => (
                      <span key={tier.minQty} className="rounded-md border px-2 py-1 text-sm">
                        {t("from", { qty: tier.minQty })}: <b>{formatMoney(tier.unitPriceGross, locale, item.price!.local?.code ?? "EUR")}</b> {t("incTax", { tax: item.taxLabel })}
                        <span className="text-xs text-muted-foreground"> ({formatMoney(tier.unitPriceNet, locale, item.price!.local?.code ?? "EUR")} {t("exTax", { tax: item.taxLabel })})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <StockBadge status={item.stockStatus} />
                {item.available > 0 && <span className="text-muted-foreground">{t("available", { count: item.available })}</span>}
                <span className="text-muted-foreground">{t("minOrder", { qty: item.minOrderQty })}</span>
                {item.qtyStep > 1 && <span className="text-muted-foreground">{t("step", { qty: item.qtyStep })}</span>}
                <span className="text-muted-foreground">{t("leadTime", { days: item.leadTimeDays })}</span>
              </div>
              {can(ctx, "buyer.orders.place") && item.price && <AddToCart offerId={item.offerId} minOrderQty={item.minOrderQty} qtyStep={item.qtyStep} />}
            </CardContent>
          </Card>
          <div className="text-sm">
            <span className="text-muted-foreground">{t("supplier")}:</span>{" "}
            {item.vendor.id
              ? <Link href={`/buy/catalogue/suppliers/${item.vendor.id}`} className="font-medium text-primary hover:underline">{item.vendor.country.flag} {item.vendor.name}</Link>
              : <span className="font-medium" data-testid="sold-by-firingi">{t("soldByFiringi")}</span>}
          </div>
          {item.vendor.badges.length > 0 && <VerifiedPanel badges={item.vendor.badges} />}
          {item.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{pickLocalized(item.description, locale)}</p>}
          {food && fl && (
            <Card id="food" data-testid="product-food">
              <CardContent className="space-y-2 pt-5">
                <h2 className="font-semibold">{fl.panelTitle}</h2>
                {food.approved ? <FoodPanel f={food} l={fl} locale={locale} labelHref={null} /> : <p className="text-sm text-muted-foreground">{fl.noInfo}</p>}
              </CardContent>
            </Card>
          )}
          {alternatives.length > 0 && (
            <div>
              <h2 className="mb-2 font-semibold">{t("otherOffers")}</h2>
              <ul className="divide-y rounded-lg border">
                {alternatives.map((a) => (
                  <li key={a.offerId} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <Link href={`/buy/catalogue/offers/${a.offerId}`} className="text-primary hover:underline">{pickLocalized(a.packaging.name, locale)} · {a.vendor.name}</Link>
                    <span className="tabular-nums">{a.price ? `${formatMoney(a.price.local?.unitPriceGross ?? a.price.unitPriceGross, locale, a.price.local?.code ?? "EUR")} ${t("incTax", { tax: a.taxLabel })}` : "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
