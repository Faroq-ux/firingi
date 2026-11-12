import { SlidersHorizontal } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { myPlan, mySettings } from "@/server/planning/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanningSettingsForm } from "@/components/planning/vendor";

export const metadata = { title: "Planning settings" };

export default async function PlanningSettings() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [cp, row, t] = await Promise.all([myPlan(ctx), mySettings(ctx), getTranslations("planning")]);
  const d = cp.defaults;
  return (
    <>
      <PageHeader title={t("settingsTitle")} description={t("settingsIntro")} icon={SlidersHorizontal} />
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t("settingsCard")}</CardTitle><CardDescription>{t("settingsHint")}</CardDescription></CardHeader>
        <CardContent>
          {can(ctx, "vendor.inventory.manage")
            ? <PlanningSettingsForm defaults={{ serviceLevel: d.serviceLevel, reviewDays: d.reviewDays, overstockDays: d.overstockDays }} initial={{ serviceLevel: row?.serviceLevel?.toString() ?? "", reviewDays: row?.reviewDays?.toString() ?? "", overstockDays: row?.overstockDays?.toString() ?? "" }} />
            : <p className="text-sm">{t("how2", { sl: cp.settings.serviceLevel, review: cp.settings.reviewDays })}</p>}
        </CardContent>
      </Card>
    </>
  );
}
