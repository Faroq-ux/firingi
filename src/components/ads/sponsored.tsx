/**
 * Sponsored products for a buyer in one placement (Phase 34) — rendered on the server, nothing when
 * there is no ad. Each card says "Sponsored" and opens the product through the click counter.
 */
import { getTranslations } from "next-intl/server";
import type { AdPlacement } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { sponsoredFor } from "@/server/ads/service";
import { productsWithImages } from "@/server/data/catalogue-admin";
import { ProductCard } from "@/components/catalogue/product-card";

export async function SponsoredProducts({ ctx, placement, q, categoryId, cartOfferIds, title }: { ctx: Ctx; placement: AdPlacement; q?: string | null; categoryId?: string | null; cartOfferIds?: string[]; title?: "featured" | "alsoNeed" }) {
  const ads = await sponsoredFor(ctx, placement, { q, categoryId, cartOfferIds }).catch(() => []);
  if (!ads.length) return null;
  const [t, images] = await Promise.all([getTranslations("ads"), productsWithImages(ads.map((a) => a.item.productId))]);
  return (
    <section className="mb-6" data-testid={`sponsored-${placement}`} aria-label={t("sponsored")}>
      {title && <h2 className="mb-3 text-lg font-semibold">{t(title)}</h2>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {ads.map((a) => <ProductCard key={a.campaignId} item={a.item} hasImage={images.has(a.item.productId)} sponsored={{ href: a.href, label: t("sponsored") }} />)}
      </div>
    </section>
  );
}
