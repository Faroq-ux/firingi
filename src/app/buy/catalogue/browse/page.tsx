import Link from "next/link";
import { EcoFilter } from "@/components/co2/views";
import { co2Filter } from "@/components/co2/filter";
import { FoodFilter, foodParams } from "@/components/food/views";
import { foodLabels } from "@/components/food/labels";
import { foodSettings } from "@/server/food/service";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, ShoppingBasket, Sparkles } from "lucide-react";
import { Aurora } from "@/components/motion/shapes";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { browseCatalogue, shopCategories, visibleSuppliers } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { orderingMode } from "@/server/allocation/mode";
import { ProductCard } from "@/components/catalogue/product-card";
import { dealBadges } from "@/server/deals/service";
import { pickLocalized } from "@/i18n/config";
import { SupplierCard } from "@/components/catalogue/supplier-card";
import { BarcodeSearch } from "@/components/catalogue/barcode-search";
import { BadgeFilter } from "@/components/compliance/badges";
import { badgeTypes } from "@/server/compliance/service";
import { SponsoredProducts } from "@/components/ads/sponsored";

export const metadata = { title: "Shop" };
const TONES = ["tone-blue", "tone-violet", "tone-teal", "tone-pink", "tone-orange", "tone-lime"];

/** Shop home: categories + nearest suppliers (wholesalers for customers, distributors for wholesalers). */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string; badge?: string; free?: string | string[]; diet?: string; eco?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const sp = await searchParams;
  const { q, badge } = sp;
  const fp = foodParams(sp); // Phase 44: allergen / diet filter
  const [categories, suppliers, t, locale, mode, badges] = await Promise.all([
    shopCategories(ctx), visibleSuppliers(ctx, { q, badge }), getTranslations("catalogue"), getLocale(), orderingMode(ctx), badgeTypes(),
  ]);
  const firingi = mode === "FIRINGI";
  const eco = sp.eco ?? null;
  const products = firingi ? await browseCatalogue(ctx, { q, badge, ...fp, eco }) : null;
  const c2 = products ? await co2Filter(ctx) : null;
  const [fs, fl] = await Promise.all([foodSettings(), foodLabels()]);
  const images = products ? await productsWithImages(products.items.map((i) => i.productId)) : new Set<string>();
  const dealMap = products ? await dealBadges(products.items.map((i) => i.offerId)) : new Map<string, { pct: number | null; endsAt: Date; kind: string }>();
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
      <SponsoredProducts ctx={ctx} placement="HOME" title="featured" />
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
          {fs.enabled && fs.filter && <FoodFilter base="/buy/catalogue/browse" params={{ q, badge }} free={fp.free} diet={fp.diet} l={fl.l} />}
          {c2 && <EcoFilter base="/buy/catalogue/browse" params={{ q, badge, free: fp.free, diet: fp.diet }} active={eco} l={c2} />}
          <h2 className="mb-3 text-lg font-semibold">{t("allProducts")}</h2>
          {products.items.length === 0 ? <p className="py-8 text-center text-muted-foreground">{t("noResults")}</p> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{products.items.map((i) => <ProductCard key={i.offerId} item={i} hasImage={images.has(i.productId)} deal={dealMap.get(i.offerId)} />)}</div>
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
