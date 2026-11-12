import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { visibleSuppliers } from "@/server/data/catalogue-buyer";
import { orderingMode } from "@/server/allocation/mode";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierCard } from "@/components/catalogue/supplier-card";
import { BadgeFilter } from "@/components/compliance/badges";
import { badgeTypes } from "@/server/compliance/service";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ badge?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const { badge } = await searchParams;
  const [rows, t, mode, badges] = await Promise.all([visibleSuppliers(ctx, { badge }), getTranslations("catalogue"), orderingMode(ctx), badgeTypes()]);
  return (
    <>
      <PageHeader title={t("suppliers")} description={t("suppliersIntro")} />
      {mode !== "FIRINGI" && <BadgeFilter types={badges} active={badge} base="/buy/catalogue/suppliers" />}
      {mode === "FIRINGI" ? <p className="rounded-md border bg-card p-4 text-sm">{t("firingiMode")}</p> : rows.length === 0 ? <p className="text-muted-foreground">{t("noSuppliers")}</p> : <div className="grid gap-3 md:grid-cols-2">{rows.map((s) => <SupplierCard key={s.id} s={s} />)}</div>}
    </>
  );
}
