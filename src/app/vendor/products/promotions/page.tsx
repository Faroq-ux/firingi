import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getLocale, getTranslations } from "next-intl/server";
import { PromotionsView } from "@/components/finance/views";
import { OfferForm, type OfferLabels } from "@/components/marketing/offer-form";
import { listOwnOffers } from "@/server/services/vendor-catalogue";
import { listOwnGroups } from "@/server/services/pricing";
import { pickLocalized } from "@/i18n/config";
import { can } from "@/server/rbac/guard";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage"]);
  const [t, f, locale, offers, groups] = await Promise.all([getTranslations("finance"), getTranslations("offerForm"), getLocale(), listOwnOffers(ctx), can(ctx, "vendor.pricing.manage") ? listOwnGroups(ctx) : Promise.resolve([])]);
  const l: OfferLabels = {
    newOffer: t("newPromotion"), newCoupon: t("newPromotion"), name: t("name"), description: f("description"), type: f("type"), value: t("discount"), buy: f("buy"), free: f("free"),
    code: f("code"), codeHint: f("codeHint"), validFrom: t("validFrom"), validTo: t("validTo"), minQty: t("minQty"), minOrder: f("minOrder"), maxRedemptions: f("maxRedemptions"),
    maxPerCustomer: f("maxPerCustomer"), firstOrder: f("firstOrder"), showInOffers: f("showInOffers"), products: f("products"), categories: "", groups: f("groups"), save: t("save"), note: t("vendorPromoNote"),
    kind_PERCENT: f("kinds.PERCENT"), kind_FIXED_AMOUNT: f("kinds.FIXED_AMOUNT"), kind_ORDER_AMOUNT: f("kinds.ORDER_AMOUNT"), kind_FREE_DELIVERY: f("kinds.FREE_DELIVERY"), kind_BUY_X_GET_Y: f("kinds.BUY_X_GET_Y"),
  };
  return (
    <PromotionsView ctx={ctx} as="VENDOR" title={t("promotions")} form={
      <OfferForm mode="VENDOR" variant="any" l={l}
        offers={offers.map((o) => ({ id: o.id, label: `${pickLocalized(o.packaging.variant.product.name, locale)} — ${pickLocalized(o.packaging.name, locale)}` }))}
        groups={groups.map((g) => ({ id: g.id, label: g.name }))} />
    } />
  );
}
