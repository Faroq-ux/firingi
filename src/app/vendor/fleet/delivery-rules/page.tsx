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
  const distributor = ctx.company.type === "DISTRIBUTOR";
  const current = rule
    ? { kind: rule.vendorMinimumKind, amount: rule.vendorDeliveryMinimum?.toString() ?? "", units: rule.vendorMinimumUnits?.toString() ?? "", flatFeeNet: rule.vendorFlatFeeNet?.toString() ?? "" }
    : null;
  const minText = rule && (rule.vendorMinimumKind === "UNITS" ? t("unitsCount", { count: rule.vendorMinimumUnits ?? 0 }) : rule.vendorDeliveryMinimum ? formatMoney(rule.vendorDeliveryMinimum.toString(), locale) : null);
  return (
    <>
      <PageHeader title={t("deliveryMinimum")} description={distributor ? t("deliveryMinimumHintDistributor") : t("deliveryMinimumHint")} />
      <Card><CardContent className="space-y-3 pt-5">
        <p className="text-sm" data-testid="current-rule">
          {minText ? <>{t("freeFrom")} <b>{minText}</b></> : distributor ? t("notSetDistributor") : t("notSet")}
          {distributor && rule?.vendorFlatFeeNet && <> · {t("flatFeeCurrent", { fee: formatMoney(rule.vendorFlatFeeNet.toString(), locale) })}</>}
        </p>
        {can(ctx, "vendor.service_areas.manage") && <VendorMinimumForm current={current} distributor={distributor} />}
      </CardContent></Card>
    </>
  );
}
