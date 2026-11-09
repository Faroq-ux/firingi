import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Store } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { visibleSuppliers } from "@/server/data/catalogue-buyer";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const [rows, t] = await Promise.all([visibleSuppliers(ctx), getTranslations("catalogue")]);
  return (
    <>
      <PageHeader title={t("suppliers")} description={t("suppliersIntro")} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((s) => (
          <Link key={s.id} href={`/buy/catalogue/browse?vendor=${s.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-primary">
            <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Store className="size-5" /></div>
            <div>
              <div className="font-medium">{s.tradeName ?? s.legalName}</div>
              <div className="text-sm text-muted-foreground">{s.country.flag} {s.addresses[0]?.cityName ?? s.country.code} · {t("productsCount", { count: s.offers })}</div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
