import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MapPin, Store } from "lucide-react";
import type { Supplier } from "@/server/data/catalogue-buyer";
import { VerifiedBadges } from "@/components/compliance/badges";

export async function SupplierCard({ s, categoryId }: { s: Supplier; categoryId?: string }) {
  const t = await getTranslations("catalogue");
  const distance = (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[color:color-mix(in_oklch,var(--vivid-teal)_14%,transparent)] px-2.5 py-1 text-xs font-semibold text-foreground">
      <MapPin className="size-3.5 text-[var(--vivid-teal)]" />
      {s.distanceKm !== null ? t("distance", { km: s.distanceKm.toLocaleString() }) : <span className="text-muted-foreground">{t("noDistance")}</span>}
    </span>
  );
  return (
    <Link
      href={`/buy/catalogue/suppliers/${s.id}${categoryId ? `?category=${categoryId}` : ""}`}
      className="glass-panel group @container flex items-center gap-3 rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-22px_color-mix(in_oklch,var(--vivid-blue)_80%,transparent)]"
    >
      <div className="tile-chip grid size-12 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-[0_8px_20px_-8px_var(--vivid-violet)] transition-transform group-hover:scale-105"><Store className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{s.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="min-w-0 break-words">{s.country.flag} {s.city ?? s.country.code}</span>
          <span>· {t("productsCount", { count: s.offers })}</span>
          {/* narrow card: the distance joins this line instead of squeezing the text */}
          <span className="@[22rem]:hidden">{distance}</span>
        </div>
        <VerifiedBadges badges={s.badges} className="mt-1" />
      </div>
      <div className="hidden shrink-0 @[22rem]:block">{distance}</div>
    </Link>
  );
}
