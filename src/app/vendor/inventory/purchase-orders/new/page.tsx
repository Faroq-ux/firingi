import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { firingiSources, listSuppliers } from "@/server/inventory/purchasing";
import { offerLabel, offerOptions, warehouseOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PoForm } from "@/components/inventory/controls";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrder() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.purchasing.manage");
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [suppliers, sources, offers, whs] = await Promise.all([listSuppliers(ctx), firingiSources(ctx), offerOptions(ctx, locale), warehouseOptions(ctx)]);
  return (
    <>
      <PageHeader title={t("newPo")} />
      <Card><CardContent className="pt-6">
        <PoForm suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))} offers={offers} warehouses={whs}
          sources={sources.map((d) => ({ id: d.id, name: d.tradeName ?? d.legalName, offers: d.vendorOffers.map((o) => ({ id: o.id, label: offerLabel(o.packaging.variant.product.name, o.packaging.name, o.vendorSku, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale)) }))} />
      </CardContent></Card>
    </>
  );
}
