import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Package } from "lucide-react";
import type { CatalogueItem } from "@/server/data/catalogue-buyer";
import { pickLocalized } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { PriceBlock, Codes } from "./price";

export async function StockBadge({ status }: { status: CatalogueItem["stockStatus"] }) {
  const t = await getTranslations("catalogue");
  return status === "IN" ? <Badge variant="success">{t("inStock")}</Badge> : status === "LOW" ? <Badge variant="warning">{t("lowStock")}</Badge> : <Badge variant="destructive">{t("outOfStock")}</Badge>;
}

export function ProductThumb({ productId, hasImage, className = "" }: { productId: string; hasImage: boolean; className?: string }) {
  return hasImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/catalogue/images/${productId}/0`} alt="" className={`object-contain ${className}`} />
  ) : (
    <div className={`grid place-items-center bg-muted text-muted-foreground ${className}`}><Package className="size-8" /></div>
  );
}

export async function ProductCard({ item, hasImage, showVendor = true }: { item: CatalogueItem; hasImage: boolean; showVendor?: boolean }) {
  const [t, locale] = await Promise.all([getTranslations("catalogue"), getLocale()]);
  return (
    <Link href={`/buy/catalogue/offers/${item.offerId}`} className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <ProductThumb productId={item.productId} hasImage={hasImage} className="h-32 w-full" />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="text-xs text-muted-foreground">{item.brand ?? pickLocalized(item.category.name, locale)}</div>
        <div className="line-clamp-2 font-medium group-hover:text-primary">{pickLocalized(item.name, locale)}</div>
        <div className="text-xs text-muted-foreground">{pickLocalized(item.packaging.name, locale)}</div>
        <Codes item={item} />
        <div className="mt-auto pt-2">
          <PriceBlock item={item} />
          {item.price && item.price.scope !== "BASE" && <Badge className="mt-1">{t(`priceScope.${item.price.scope}`)}</Badge>}
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{showVendor ? `${item.vendor.country.flag ?? ""} ${item.vendor.name}` : ""}</span>
            <StockBadge status={item.stockStatus} />
          </div>
        </div>
      </div>
    </Link>
  );
}
