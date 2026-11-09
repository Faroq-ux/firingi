import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MapPin, Store } from "lucide-react";
import type { Supplier } from "@/server/data/catalogue-buyer";

export async function SupplierCard({ s, categoryId }: { s: Supplier; categoryId?: string }) {
  const t = await getTranslations("catalogue");
  return (
    <Link
      href={`/buy/catalogue/suppliers/${s.id}${categoryId ? `?category=${categoryId}` : ""}`}
      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary"
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Store className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{s.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>{s.country.flag} {s.city ?? s.country.code}</span>
          <span>· {t("productsCount", { count: s.offers })}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-sm font-medium">
        <MapPin className="size-4 text-muted-foreground" />
        {s.distanceKm !== null ? t("distance", { km: s.distanceKm.toLocaleString() }) : <span className="text-muted-foreground">{t("noDistance")}</span>}
      </div>
    </Link>
  );
}
