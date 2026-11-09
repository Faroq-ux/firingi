import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { browsableCategories, browseCatalogue, visibleSuppliers } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { ProductCard } from "@/components/catalogue/product-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export const metadata = { title: "Catalogue" };

export default async function BrowsePage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; vendor?: string; page?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const sp = await searchParams;
  const [data, categories, suppliers, t, c, locale] = await Promise.all([
    browseCatalogue(ctx, { q: sp.q, categoryId: sp.category || undefined, vendorId: sp.vendor || undefined, page: Number(sp.page) || 1 }),
    browsableCategories(ctx), visibleSuppliers(ctx), getTranslations("catalogue"), getTranslations("common"), getLocale(),
  ]);
  const withImages = await productsWithImages(data.items.map((i) => i.productId));
  const qs = (page: number) => `/buy/catalogue/browse?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.category ? { category: sp.category } : {}), ...(sp.vendor ? { vendor: sp.vendor } : {}), page: String(page) })}`;
  return (
    <>
      <PageHeader title={t("browse")} description={t("results", { count: data.total })} />
      <form className="mb-5 flex flex-wrap gap-2" action="/buy/catalogue/browse">
        <Input name="q" defaultValue={sp.q} placeholder={t("search")} className="min-w-56 flex-1" />
        <Select name="category" defaultValue={sp.category ?? ""} className="w-56">
          <option value="">{t("allCategories")}</option>
          {categories.map((cat) => <option key={cat.id} value={cat.id}>{"— ".repeat(cat.depth)}{pickLocalized(cat.name, locale)}</option>)}
        </Select>
        <Select name="vendor" defaultValue={sp.vendor ?? ""} className="w-48">
          <option value="">{t("allSuppliers")}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName ?? s.legalName}</option>)}
        </Select>
        <Button type="submit">{c("search")}</Button>
      </form>
      {data.items.length === 0 ? <p className="py-16 text-center text-muted-foreground">{t("noResults")}</p> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {data.items.map((i) => <ProductCard key={i.offerId} item={i} hasImage={withImages.has(i.productId)} />)}
        </div>
      )}
      <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground">
        <span>{c("pageOf", { page: data.page, count: data.pageCount })}</span>
        <div className="flex gap-2">
          {data.page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(data.page - 1)}>{c("previous")}</Link>}
          {data.page < data.pageCount && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(data.page + 1)}>{c("next")}</Link>}
        </div>
      </div>
    </>
  );
}
