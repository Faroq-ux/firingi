import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, ShoppingBasket } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { shopCategories, visibleSuppliers } from "@/server/data/catalogue-buyer";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierCard } from "@/components/catalogue/supplier-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Shop" };

/** Shop home: categories + nearest suppliers (wholesalers for customers, distributors for wholesalers). */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { q } = await searchParams;
  const [categories, suppliers, t, c, locale] = await Promise.all([
    shopCategories(ctx), visibleSuppliers(ctx, { q }), getTranslations("catalogue"), getTranslations("common"), getLocale(),
  ]);
  return (
    <>
      <PageHeader title={t("shop")} description={t("shopIntro")} />
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
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("nearestSuppliers")}</h2>
          <form className="flex gap-2" action="/buy/catalogue/browse">
            <Input name="q" defaultValue={q} placeholder={t("findSupplier")} className="w-64" />
            <Button type="submit" variant="outline">{c("search")}</Button>
          </form>
        </div>
        {suppliers.length === 0 ? <p className="py-8 text-center text-muted-foreground">{t("noSuppliers")}</p> : (
          <div className="grid gap-3 md:grid-cols-2">{suppliers.slice(0, 8).map((s) => <SupplierCard key={s.id} s={s} />)}</div>
        )}
        {suppliers.length > 8 && <Link href="/buy/catalogue/suppliers" className="mt-3 inline-block text-sm text-primary hover:underline">{t("allSuppliersLink")} →</Link>}
      </section>
    </>
  );
}
