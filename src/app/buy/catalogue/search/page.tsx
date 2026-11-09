import { getLocale, getTranslations } from "next-intl/server";
import { MapPin } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { searchAcrossSuppliers } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { PageHeader } from "@/components/layout/page-header";
import { ProductCard } from "@/components/catalogue/product-card";
import { BarcodeSearch } from "@/components/catalogue/barcode-search";

export const metadata = { title: "Search" };

/** Find goods across all suppliers — by barcode (exact) or name / SKU — nearest supplier first. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const q = (await searchParams).q ?? "";
  const [res, t] = await Promise.all([searchAcrossSuppliers(ctx, q), getTranslations("catalogue")]);
  const images = await productsWithImages(res.items.map((i) => i.productId));
  const locale = await getLocale();
  return (
    <>
      <PageHeader
        title={q ? t("searchResults", { q }) : t("shop")}
        description={res.barcode ? t("barcodeResults", { code: res.barcode, count: res.items.length }) : t("oneSupplier")}
      />
      <div className="mb-6 max-w-2xl"><BarcodeSearch action="/buy/catalogue/search" defaultValue={q} /></div>
      {q && res.items.length === 0 && <p className="py-12 text-center text-muted-foreground">{t("noMatch", { q })}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {res.items.map((i) => (
          <div key={i.offerId} className="flex flex-col">
            <ProductCard item={i} hasImage={images.has(i.productId)} />
            <div className="mt-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
              <MapPin className="size-3" /> {i.distanceKm !== null ? t("distance", { km: i.distanceKm.toLocaleString(locale) }) : t("noDistance")}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
