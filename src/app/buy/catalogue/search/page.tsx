import { getLocale, getTranslations } from "next-intl/server";
import { MapPin } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { searchAcrossSuppliers } from "@/server/data/catalogue-buyer";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { PageHeader } from "@/components/layout/page-header";
import { ProductCard } from "@/components/catalogue/product-card";
import { dealBadges } from "@/server/deals/service";
import { BarcodeSearch } from "@/components/catalogue/barcode-search";
import { SponsoredProducts } from "@/components/ads/sponsored";
import { foodLabels } from "@/components/food/labels";
import { foodSettings } from "@/server/food/service";
import { searchAiStatus, searchSettings } from "@/server/search/service";
import { orderingMode } from "@/server/allocation/mode";
import { SORTS, parseFilters } from "@/lib/search";
import { SearchFilterPanel, UnderstoodBar, type SearchLabels } from "@/components/search/views";

export const metadata = { title: "Search" };

type Sp = Record<string, string | string[] | undefined>;

/**
 * Find goods across all suppliers — by barcode (exact) or words. Phase 72: typo- and accent-tolerant matching,
 * the AI reads the search (other languages, synonyms, filters it understood — removable), filters and sorting.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const aiOff = sp.aif === "0";
  const locale = await getLocale();
  const [settings, ai, mode] = await Promise.all([searchSettings(), searchAiStatus(), orderingMode(ctx)]);
  const asked = parseFilters(sp);
  const [res, t, ts, fs, fl] = await Promise.all([
    searchAcrossSuppliers(ctx, q, null, { filters: asked, ai: true, aiFilters: !aiOff, locale }),
    getTranslations("catalogue"), getTranslations("smartSearch"), foodSettings(), foodLabels(),
  ]);
  const images = await productsWithImages(res.items.map((i) => i.productId));
  const dealMap = await dealBadges(res.items.map((i) => i.offerId));
  const l: SearchLabels = {
    ...Object.fromEntries(["filters", "category", "anyCategory", "supplier", "anySupplier", "maxPrice", "dealsOnly", "sort", "rating", "anyRating", "apply", "clear",
      "understood", "simulated", "onlyWords", "useAi", "remove", "partial", "chipDeal"].map((k) => [k, ts(k)])),
    ...Object.fromEntries(SORTS.map((s) => [`sortBy.${s}`, ts(`sortBy.${s}`)])),
    starsUp: ts("starsUp", { n: "{n}" }), lookingFor: ts("lookingFor", { words: "{words}" }), didYouMean: ts("didYouMean", { q: "{q}" }),
    chipMax: ts("chipMax", { price: "{price}" }), chipFree: ts("chipFree", { list: "{list}" }),
  };
  const currency = res.items.find((i) => i.price?.local)?.price?.local?.code ?? "EUR";
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  const f = res.meta?.applied ?? asked;
  const showFilters = settings.filters && !!q && !res.barcode;
  return (
    <>
      <PageHeader
        title={q ? t("searchResults", { q }) : t("shop")}
        description={res.barcode ? t("barcodeResults", { code: res.barcode, count: res.items.length }) : q && res.meta ? ts("results", { count: res.meta.total }) : t("oneSupplier")}
      />
      <div className="mb-4 max-w-2xl"><BarcodeSearch action="/buy/catalogue/search" defaultValue={q} /></div>
      {!q && <p className="mb-6 max-w-2xl text-sm text-muted-foreground" data-testid="search-tip">{ts("tip")}</p>}
      {q && <UnderstoodBar q={q} f={f} meta={res.meta} l={l} fl={fl.l} money={money} aiOff={aiOff} aiReady={ai.ready} />}
      <div className={showFilters ? "grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]" : ""}>
        {showFilters && res.meta && (
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <SearchFilterPanel q={q} f={f} facets={res.meta.facets} showSupplier={mode !== "FIRINGI"} food={fs.enabled && fs.filter} l={l} fl={fl.l} aiOff={aiOff} />
          </aside>
        )}
        <div className="min-w-0">
          {q && <SponsoredProducts ctx={ctx} placement="SEARCH" q={q} />}
          {q && res.items.length === 0 && <p className="py-12 text-center text-muted-foreground" data-testid="no-results">{ts("noResults", { q })}</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" data-testid="search-results">
            {res.items.map((i) => (
              <div key={i.offerId} className="flex flex-col" data-testid="search-hit" data-product={i.name.en ?? ""}>
                <ProductCard item={i} hasImage={images.has(i.productId)} deal={dealMap.get(i.offerId)} />
                <div className="mt-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
                  <MapPin className="size-3" /> {i.distanceKm !== null ? t("distance", { km: i.distanceKm.toLocaleString(locale) }) : t("noDistance")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
