import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { browseCatalogue, shopCategory, visibleSuppliers } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { orderingMode } from "@/server/allocation/mode";
import { ProductCard } from "@/components/catalogue/product-card";
import { dealBadges } from "@/server/deals/service";
import { SponsoredProducts } from "@/components/ads/sponsored";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierCard } from "@/components/catalogue/supplier-card";

/** A category: its sub-categories and the suppliers carrying it, nearest first. */
export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { id } = await params;
  const data = await shopCategory(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [suppliers, t, locale, mode] = await Promise.all([visibleSuppliers(ctx, { categoryId: id }), getTranslations("catalogue"), getLocale(), orderingMode(ctx)]);
  const products = mode === "FIRINGI" ? await browseCatalogue(ctx, { categoryId: id }) : null;
  const images = products ? await productsWithImages(products.items.map((i) => i.productId)) : new Set<string>();
  const dealMap = products ? await dealBadges(products.items.map((i) => i.offerId)) : new Map<string, { pct: number | null; endsAt: Date; kind: string }>();
  const name = pickLocalized(data.category.name, locale);
  return (
    <>
      <nav className="mb-2 flex flex-wrap gap-1 text-sm text-muted-foreground">
        <Link href="/buy/catalogue/browse" className="hover:text-primary">{t("shop")}</Link>
        {data.breadcrumb.map((b) => <span key={b.id}> / <Link href={`/buy/catalogue/categories/${b.id}`} className="hover:text-primary">{pickLocalized(b.name, locale)}</Link></span>)}
      </nav>
      <PageHeader title={name} description={products ? t("firingiMode") : t("oneSupplier")} />
      {data.children.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {data.children.map((ch) => <Link key={ch.id} href={`/buy/catalogue/categories/${ch.id}`} className="rounded-full border bg-card px-3 py-1 text-sm hover:border-primary">{pickLocalized(ch.name, locale)}</Link>)}
        </div>
      )}
      <SponsoredProducts ctx={ctx} placement="CATEGORY" categoryId={id} />
      {products ? (
        products.items.length === 0 ? <p className="py-8 text-center text-muted-foreground">{t("noResults")}</p> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" data-testid="firingi-products">{products.items.map((i) => <ProductCard key={i.offerId} item={i} hasImage={images.has(i.productId)} deal={dealMap.get(i.offerId)} />)}</div>
        )
      ) : (
        <>
          <h2 className="mb-3 text-lg font-semibold">{t("suppliersInCategory", { category: name })}</h2>
          {suppliers.length === 0 ? <p className="py-8 text-center text-muted-foreground">{t("noSuppliers")}</p> : (
            <div className="grid gap-3 md:grid-cols-2">{suppliers.map((s) => <SupplierCard key={s.id} s={s} categoryId={id} />)}</div>
          )}
        </>
      )}
    </>
  );
}
