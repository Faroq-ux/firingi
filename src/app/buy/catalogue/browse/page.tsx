import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, ShoppingBasket, Sparkles } from "lucide-react";
import { Aurora } from "@/components/motion/shapes";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { browseCatalogue, shopCategories, visibleSuppliers } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { orderingMode } from "@/server/allocation/mode";
import { ProductCard } from "@/components/catalogue/product-card";
import { pickLocalized } from "@/i18n/config";
import { SupplierCard } from "@/components/catalogue/supplier-card";
import { BarcodeSearch } from "@/components/catalogue/barcode-search";
import { BadgeFilter } from "@/components/compliance/badges";
import { badgeTypes } from "@/server/compliance/service";

export const metadata = { title: "Shop" };
const TONES = ["tone-blue", "tone-violet", "tone-teal", "tone-pink", "tone-orange", "tone-lime"];

/** Shop home: categories + nearest suppliers (wholesalers for customers, distributors for wholesalers). */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string; badge?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { q, badge } = await searchParams;
  const [categories, suppliers, t, locale, mode, badges] = await Promise.all([
    shopCategories(ctx), visibleSuppliers(ctx, { q, badge }), getTranslations("catalogue"), getLocale(), orderingMode(ctx), badgeTypes(),
  ]);
  const firingi = mode === "FIRINGI";
  const products = firingi ? await browseCatalogue(ctx, { q, badge }) : null;
  const images = products ? await productsWithImages(products.items.map((i) => i.productId)) : new Set<string>();
  return (
    <>
      <Aurora className="mb-8">
        <div className="max-w-2xl">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white/85"><Sparkles className="size-3.5" aria-hidden />{ctx.company.tradeName ?? ctx.company.legalName}</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{t("shop")}</h1>
          <p className="mt-1 text-white/80">{firingi ? t("firingiMode") : t("shopIntro")}</p>
          <div className="glass mt-5 rounded-2xl p-2"><BarcodeSearch action="/buy/catalogue/search" /></div>
        </div>
      </Aurora>
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">{t("categories")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {categories.filter((cat) => cat.products > 0).map((cat, i) => (
            <Link key={cat.id} href={`/buy/catalogue/categories/${cat.id}`} className={`tile gloss motion-lift group flex items-center gap-3 rounded-2xl border p-3 ${TONES[i % TONES.length]}`}>
              <div className="tile-chip grid size-10 shrink-0 place-items-center rounded-xl"><ShoppingBasket className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium group-hover:text-primary">{pickLocalized(cat.name, locale)}</div>
                <div className="text-xs text-muted-foreground">{t("productsCount", { count: cat.products })}</div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>
      <BadgeFilter types={badges} active={badge} base="/buy/catalogue/browse" params={{ q }} />
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
