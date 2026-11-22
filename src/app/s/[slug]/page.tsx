/**
 * Phase 61 — a wholesaler's (or distributor's) storefront: public, no sign-in. Branding, delivery terms, current
 * offers and products (never prices). Businesses register from here and are linked to the store.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ArrowRight, LogIn, MapPin, Package, ShieldCheck, Store } from "lucide-react";
import { getContext } from "@/server/context";
import { countView, publicStorefront } from "@/server/storefront/service";
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle";
import { DeliveryTerms, StoreOffers } from "@/components/storefront/views";
import { fill, sfLabels } from "@/components/storefront/labels";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const v = await publicStorefront((await params).slug, null, await getLocale()).catch(() => null);
  if (!v) return { title: "FIRINGI", robots: { index: false } };
  return { title: { absolute: `${v.store.name} · FIRINGI` }, description: v.store.tagline ?? undefined };
}

export default async function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [viewer, locale] = await Promise.all([getContext().catch(() => null), getLocale()]);
  const v = await publicStorefront(slug, viewer, locale);
  if (!v) notFound();
  const { l } = await sfLabels();
  const s = v.store;
  const own = viewer?.company.id === s.companyId || viewer?.company.type === "ADMIN";
  if (!own && v.status === "PUBLISHED") await countView(s.companyId);
  const img = (k: string) => `/api/storefront/${s.slug}/${k}`;
  const shopHref = `/buy/catalogue/suppliers/${s.companyId}`;
  return (
    <main className="min-h-dvh bg-background text-foreground" data-testid="storefront" style={{ ["--sf" as string]: s.accent }}>
      {v.preview && <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" data-testid="sf-preview">{l.preview}</p>}
      <header className="relative">
        <div className="relative h-44 w-full overflow-hidden sm:h-64" style={{ background: `linear-gradient(135deg, ${s.accent}, color-mix(in oklch, ${s.accent} 55%, black))` }}>
          {s.hasBanner && /* eslint-disable-next-line @next/next/no-img-element */ <img src={img("banner")} alt="" className="absolute inset-0 size-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <PublicThemeToggle className="absolute right-3 top-3 z-10 text-white" />
          <Link href="/" className="absolute left-4 top-3 z-10 text-sm font-semibold tracking-[0.14em] text-white/90">FIRINGI</Link>
        </div>
        <div className="relative z-10 mx-auto -mt-14 flex max-w-6xl flex-wrap items-end gap-4 px-4">
          <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-background bg-card shadow-lg sm:size-28">
            {s.hasLogo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={img("logo")} alt={s.name} className="size-full object-contain" /> : <Store className="size-10" style={{ color: s.accent }} />}
          </div>
          <div className="min-w-0 flex-1 basis-60 pb-1">
            <h1 className="break-words text-2xl font-bold sm:text-3xl" data-testid="sf-name">{s.name}</h1>
            {s.tagline && <p className="break-words text-muted-foreground" data-testid="sf-tagline">{s.tagline}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {s.country.flag} {[s.city, s.country.name].filter(Boolean).join(", ")}</span>
              <span className="inline-flex items-center gap-1"><Package className="size-3.5" /> {fill(l.productsCount, { count: v.productCount })}</span>
              <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" /> FIRINGI</span>
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 pb-1 sm:w-auto">
            {v.viewerIsBuyer ? (
              <Link href={shopHref} className="inline-flex h-11 items-center gap-2 rounded-xl px-5 font-medium text-white shadow-md" style={{ background: s.accent }} data-testid="sf-open">{l.openStore} <ArrowRight className="size-4" /></Link>
            ) : (
              <>
                <Link href={v.registerPath} className="inline-flex h-11 items-center gap-2 rounded-xl px-5 font-medium text-white shadow-md" style={{ background: s.accent }} data-testid="sf-register">{l.registerCta} <ArrowRight className="size-4" /></Link>
                {!viewer && <Link href={`/login?next=${encodeURIComponent(shopHref)}`} className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium" data-testid="sf-signin"><LogIn className="size-4" /> {l.signIn}</Link>}
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <StoreOffers l={l} locale={locale} o={v.offers} accent={s.accent} />
          <section className="rounded-2xl border bg-card p-4" data-testid="sf-products">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{l.productsTitle}</h2>
              <span className="text-xs text-muted-foreground">{l.pricesNote}</span>
            </div>
            {!v.showProducts ? <p className="text-sm text-muted-foreground">{l.productsHidden}</p> : (
              <>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {v.products.map((p) => (
                    <li key={p.offerId} className="min-w-0 overflow-hidden rounded-xl border bg-background" data-testid="sf-product" data-featured={p.featured ? "1" : "0"}>
                      <div className="relative grid aspect-square place-items-center bg-muted/40">
                        {p.hasImage ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={img(`p-${p.productId}`)} alt="" loading="lazy" className="size-full object-contain p-2" /> : <Package className="size-8 text-muted-foreground" />}
                        {p.featured && <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: s.accent }}>{l.featuredBadge}</span>}
                      </div>
                      <div className="p-2">
                        <p className="line-clamp-2 break-words text-sm font-medium">{p.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{[p.brand, p.packaging].filter(Boolean).join(" · ")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {v.productCount > v.products.length && <p className="mt-3 text-sm text-muted-foreground">{l.moreAfterSignIn}</p>}
              </>
            )}
          </section>
        </div>
        <aside className="min-w-0 space-y-4">
          <DeliveryTerms l={l} locale={locale} d={v.delivery} accent={s.accent} />
          {s.about && (
            <section className="rounded-2xl border bg-card p-4" data-testid="sf-about">
              <h2 className="mb-2 font-semibold">{l.aboutTitle}</h2>
              <p className="whitespace-pre-line break-words text-sm leading-relaxed">{s.about}</p>
            </section>
          )}
          {v.categories.length > 0 && (
            <section className="rounded-2xl border bg-card p-4">
              <h2 className="mb-2 font-semibold">{l.categoriesTitle}</h2>
              <ul className="flex flex-wrap gap-1.5">{v.categories.map((c) => <li key={c.id} className={cn("rounded-full border px-2.5 py-1 text-xs")}>{c.name} <span className="text-muted-foreground">{c.count}</span></li>)}</ul>
            </section>
          )}
          <p className="px-1 text-xs text-muted-foreground">{l.poweredBy}</p>
        </aside>
      </div>
    </main>
  );
}
