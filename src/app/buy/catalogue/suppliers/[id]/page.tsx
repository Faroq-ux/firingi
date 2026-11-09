import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { MapPin } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { browseCatalogue, supplierStore } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { ProductCard } from "@/components/catalogue/product-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A supplier's store: every product that supplier offers to this buyer. */
export default async function StorePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; category?: string; page?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const store = await supplierStore(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const category = store.categories.some((c) => c.id === sp.category) ? sp.category : undefined;
  const [data, t, c, locale] = await Promise.all([
    browseCatalogue(ctx, { vendorId: id, categoryId: category, q: sp.q, page: Number(sp.page) || 1 }),
    getTranslations("catalogue"), getTranslations("common"), getLocale(),
  ]);
  const images = await productsWithImages(data.items.map((i) => i.productId));
  const base = `/buy/catalogue/suppliers/${id}`;
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, category, ...o }).filter(([, v]) => v) as [string, string][]);
    return p.toString() ? `${base}?${p}` : base;
  };
  const s = store.supplier;
  return (
    <>
      <Link href="/buy/catalogue/browse" className="text-sm text-primary hover:underline">← {t("shop")}</Link>
      <PageHeader
        title={s.name}
        description={<span className="flex flex-wrap items-center gap-2">{s.country.flag} {s.city} <MapPin className="size-3.5" />{s.distanceKm !== null ? t("distance", { km: s.distanceKm.toLocaleString() }) : t("noDistance")} · {t("productsCount", { count: s.offers })}</span>}
      />
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <aside className="space-y-1 lg:sticky lg:top-20 lg:self-start">
          <Link href={qs({ category: undefined, page: undefined })} className={cn("block rounded-md px-2 py-1.5 text-sm hover:bg-accent", !category && "bg-accent font-medium")}>{t("allProducts")} ({s.offers})</Link>
          {store.categories.map((cat) => (
            <Link key={cat.id} href={qs({ category: cat.id, page: undefined })} style={{ paddingLeft: 8 + cat.depth * 14 }}
              className={cn("block rounded-md py-1.5 pr-2 text-sm hover:bg-accent", category === cat.id && "bg-accent font-medium")}>
              {pickLocalized(cat.name, locale)} <span className="text-xs text-muted-foreground">({cat.products})</span>
            </Link>
          ))}
        </aside>
        <div>
          <form className="mb-4 flex gap-2" action={base}>
            {category && <input type="hidden" name="category" value={category} />}
            <Input name="q" defaultValue={sp.q} placeholder={t("storeSearch")} className="flex-1" />
            <Button type="submit">{c("search")}</Button>
          </form>
          {data.items.length === 0 ? <p className="py-12 text-center text-muted-foreground">{t("noResults")}</p> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {data.items.map((i) => <ProductCard key={i.offerId} item={i} hasImage={images.has(i.productId)} showVendor={false} />)}
            </div>
          )}
          <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground">
            <span>{c("pageOf", { page: data.page, count: data.pageCount })}</span>
            <div className="flex gap-2">
              {data.page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(data.page - 1) })}>{c("previous")}</Link>}
              {data.page < data.pageCount && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(data.page + 1) })}>{c("next")}</Link>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
