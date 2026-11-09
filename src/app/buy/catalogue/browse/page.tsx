import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, ShoppingBasket } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { browseCatalogue, shopCategories, visibleSuppliers } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { orderingMode } from "@/server/allocation/mode";
import { ProductCard } from "@/components/catalogue/product-card";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierCard } from "@/components/catalogue/supplier-card";
import { BarcodeSearch } from "@/components/catalogue/barcode-search";

export const metadata = { title: "Shop" };

/** Shop home: categories + nearest suppliers (wholesalers for customers, distributors for wholesalers). */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { q } = await searchParams;
  const [categories, suppliers, t, locale, mode] = await Promise.all([
    shopCategories(ctx), visibleSuppliers(ctx, { q }), getTranslations("catalogue"), getLocale(), orderingMode(ctx),
  ]);
  const firingi = mode === "FIRINGI";
  const products = firingi ? await browseCatalogue(ctx, { q }) : null;
  const images = products ? await productsWithImages(products.items.map((i) => i.productId)) : new Set<string>();
  return (
    <>
      <PageHeader title={t("shop")} description={firingi ? t("firingiMode") : t("shopIntro")} />
      <div className="mb-8 max-w-2xl"><BarcodeSearch action="/buy/catalogue/search" /></div>
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">{t("categories")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {categories.filter((cat) => cat.products > 0).map((cat) => (
            <Link key={cat.id} href={`/buy/catalogue/categories/${cat.id}`} className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ShoppingBasket className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium group-hover:text-primary">{pickLocalized(cat.name, locale)}</div>
                <div className="text-xs text-muted-foreground">{t("productsCount", { count: cat.products })}</div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>
      {products ? (
        <section data-testid="firingi-products">
          <h2 className="mb-3 text-lg font-semibold">{t("allProducts")}</h2>
          {products.items.length === 0 ? <p className="py-8 text-center text-muted-foreground">{t("noResults")}</p> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{products.items.map((i) => <ProductCard key={i.offerId} item={i} hasImage={images.has(i.productId)} />)}</div>
          )}
        </section>
      ) : (
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("nearestSuppliers")}</h2>
        {suppliers.length === 0 ? <p className="py-8 text-center text-muted-foreground">{t("noSuppliers")}</p> : (
          <div className="grid gap-3 md:grid-cols-2">{suppliers.slice(0, 8).map((s) => <SupplierCard key={s.id} s={s} />)}</div>
        )}
        {suppliers.length > 8 && <Link href="/buy/catalogue/suppliers" className="mt-3 inline-block text-sm text-primary hover:underline">{t("allSuppliersLink")} →</Link>}
      </section>
      )}
    </>
  );
}
