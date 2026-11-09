import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { catalogueItem } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProductThumb, StockBadge } from "@/components/catalogue/product-card";
import { Codes, PriceBlock } from "@/components/catalogue/price";
import { formatMoney } from "@/lib/utils";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { id } = await params;
  const data = await catalogueItem(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const { item, alternatives } = data;
  const [t, locale, images] = await Promise.all([getTranslations("catalogue"), getLocale(), productsWithImages([item.productId])]);
  const name = pickLocalized(item.name, locale);

  return (
    <>
      <Link href={`/buy/catalogue/suppliers/${item.vendor.id}`} className="text-sm text-primary hover:underline">← {t("backToStore", { name: item.vendor.name })}</Link>
      <div className="mt-4 grid gap-6 md:grid-cols-[18rem_1fr]">
        <ProductThumb productId={item.productId} hasImage={images.has(item.productId)} className="h-64 w-full rounded-xl border" />
        <div className="space-y-4">
          <div>
            <div className="text-sm text-muted-foreground">{item.brand ?? ""} {item.brand ? "·" : ""} {pickLocalized(item.category.name, locale)}</div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{pickLocalized(item.packaging.name, locale)}</Badge>

              {item.restriction && <Badge variant="warning">{t(`restricted.${item.restriction}`)}</Badge>}
            </div>
            <div className="mt-2"><Codes item={item} full /></div>
          </div>
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
                    {item.price.tiers.map((tier) => (
                      <span key={tier.minQty} className="rounded-md border px-2 py-1 text-sm">
                        {t("from", { qty: tier.minQty })}: <b>{formatMoney(tier.unitPriceGross, locale)}</b> {t("incTax", { tax: item.taxLabel })}
                        <span className="text-xs text-muted-foreground"> ({formatMoney(tier.unitPriceNet, locale)} {t("exTax", { tax: item.taxLabel })})</span>
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
              <div className="flex items-center gap-3">
                <Button disabled>{t("addToCart")}</Button>
                <span className="text-xs text-muted-foreground">{t("cartPhase")}</span>
              </div>
            </CardContent>
          </Card>
          <div className="text-sm">
            <span className="text-muted-foreground">{t("supplier")}:</span>{" "}
            <Link href={`/buy/catalogue/suppliers/${item.vendor.id}`} className="font-medium text-primary hover:underline">{item.vendor.country.flag} {item.vendor.name}</Link>
          </div>
          {item.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{pickLocalized(item.description, locale)}</p>}
          {alternatives.length > 0 && (
            <div>
              <h2 className="mb-2 font-semibold">{t("otherOffers")}</h2>
              <ul className="divide-y rounded-lg border">
                {alternatives.map((a) => (
                  <li key={a.offerId} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <Link href={`/buy/catalogue/offers/${a.offerId}`} className="text-primary hover:underline">{pickLocalized(a.packaging.name, locale)} · {a.vendor.name}</Link>
                    <span className="tabular-nums">{a.price ? `${formatMoney(a.price.unitPriceGross, locale)} ${t("incTax", { tax: a.taxLabel })}` : "—"}</span>
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
