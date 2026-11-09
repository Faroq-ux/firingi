import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { ownVendorMinimum } from "@/server/services/delivery-rules";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VendorMinimumForm } from "@/components/orders/delivery-rule-forms";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Delivery rules" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.service_areas.manage", "vendor.fleet.view"]);
  const [rule, t, locale] = await Promise.all([ownVendorMinimum(ctx), getTranslations("orders.vendor"), getLocale()]);
  const current = rule?.vendorDeliveryMinimum?.toString() ?? null;
  return (
    <>
      <PageHeader title={t("deliveryMinimum")} description={t("deliveryMinimumHint")} />
      <Card><CardContent className="space-y-3 pt-5">
        <p className="text-sm">{current ? <b>{formatMoney(current, locale)}</b> : t("notSet")}</p>
        {can(ctx, "vendor.service_areas.manage") && <VendorMinimumForm current={current} />}
      </CardContent></Card>
    </>
  );
}
