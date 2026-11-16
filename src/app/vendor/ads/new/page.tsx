import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { campaignOptions } from "@/server/ads/service";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CampaignForm } from "@/components/ads/vendor";

export const metadata = { title: "New ad" };
export const dynamic = "force-dynamic";

export default async function NewAd() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.promotions.manage");
  const [o, t, locale] = await Promise.all([campaignOptions(ctx).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; }), getTranslations("ads"), getLocale()]);
  const byId = new Map(o.categories.map((c) => [c.id, c]));
  const path = (id: string) => { const out: string[] = []; let c = byId.get(id); while (c && out.length < 5) { out.unshift(pickLocalized(c.name, locale)); c = c.parentId ? byId.get(c.parentId) : undefined; } return out.join(" › "); };
  return (
    <>
      <PageHeader title={t("formTitle")} icon={Megaphone} description={t("formIntro")} />
      <Card><CardContent className="pt-5">
        <CampaignForm rules={o.settings.placements} approval={o.settings.approvalRequired} locale={locale}
          offers={o.offers.map((x) => ({ id: x.id, label: `${pickLocalized(x.name, locale)} — ${pickLocalized(x.pack, locale)} (${x.sku})` }))}
          categories={o.categories.map((c) => ({ id: c.id, label: path(c.id) })).sort((a, b) => a.label.localeCompare(b.label, locale))} />
      </CardContent></Card>
    </>
  );
}
