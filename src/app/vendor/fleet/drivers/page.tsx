import { getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { ownFleet } from "@/server/services/fleet";
import { multiOrderPolicy, vendorMultiOrder } from "@/server/services/delivery-settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DriversTable } from "@/components/delivery/fleet-views";
import { AddDriverForm, MultiOrderForm } from "@/components/delivery/delivery-forms";

export const metadata = { title: "Drivers" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.fleet.view", "vendor.drivers.manage"]);
  const [fleet, policy, mine, t] = await Promise.all([ownFleet(ctx), multiOrderPolicy(), vendorMultiOrder(ctx.company.id), getTranslations("delivery")]);
  const manage = can(ctx, "vendor.drivers.manage");
  return (
    <>
      <PageHeader title={t("drivers")} description={t("fleetIntro")} actions={manage ? <AddDriverForm /> : undefined} />
      <Card className="mb-4"><CardHeader><CardTitle>{t("multiOrder")}</CardTitle></CardHeader>
        <CardContent className="space-y-2"><p className="text-sm text-muted-foreground">{t("multiOrderHint")}</p>
          {manage ? <MultiOrderForm enabled={mine.enabled && policy.vendorsMayUse} max={mine.max} cap={policy.vendorMaxCap} allowed={policy.vendorsMayUse} /> : <p className="text-sm">{mine.enabled && policy.vendorsMayUse ? `${t("on")} · ${mine.max}` : t("off")}</p>}
        </CardContent>
      </Card>
      <Card><CardContent className="pt-5"><DriversTable drivers={fleet.drivers} manage={manage} /></CardContent></Card>
    </>
  );
}
