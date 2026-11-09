import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { visibleSuppliers } from "@/server/data/catalogue-buyer";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierCard } from "@/components/catalogue/supplier-card";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.catalogue.view");
  const [rows, t] = await Promise.all([visibleSuppliers(ctx), getTranslations("catalogue")]);
  return (
    <>
      <PageHeader title={t("suppliers")} description={t("suppliersIntro")} />
      {rows.length === 0 ? <p className="text-muted-foreground">{t("noSuppliers")}</p> : <div className="grid gap-3 md:grid-cols-2">{rows.map((s) => <SupplierCard key={s.id} s={s} />)}</div>}
    </>
  );
}
