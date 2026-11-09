import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getLocale, getTranslations } from "next-intl/server";
import { PromotionsView } from "@/components/finance/views";
import { PromotionForm } from "@/components/finance/controls";
import { listOwnOffers } from "@/server/services/vendor-catalogue";
import { listOwnGroups } from "@/server/services/pricing";
import { pickLocalized } from "@/i18n/config";
import { can } from "@/server/rbac/guard";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage"]);
  const [t, locale, offers, groups] = await Promise.all([getTranslations("finance"), getLocale(), listOwnOffers(ctx), can(ctx, "vendor.pricing.manage") ? listOwnGroups(ctx) : Promise.resolve([])]);
  return <PromotionsView ctx={ctx} as="VENDOR" title={t("promotions")} form={<PromotionForm mode="VENDOR" offers={offers.map((o) => ({ id: o.id, label: `${pickLocalized(o.packaging.variant.product.name, locale)} — ${pickLocalized(o.packaging.name, locale)}` }))} groups={groups.map((g) => ({ id: g.id, label: g.name }))} />} />;
}
