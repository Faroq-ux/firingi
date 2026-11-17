import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { DriverList } from "@/components/delivery/driver-views";
import { AvailabilitySwitch } from "@/components/delivery/delivery-forms";
import { myAvailability } from "@/server/services/fleet";
import { myRoutes } from "@/server/services/routes";
import { DriverRoutes } from "@/components/routes/route-views";
import { driverPickups } from "@/server/returnables/service";
import { rtLabels } from "@/components/returnables/labels";
import { CollectPickupForm } from "@/components/returnables/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Today's deliveries" };

export default async function Page() {
  const ctx = await pagePortal("driver");
  pagePermission(ctx, "driver.deliveries.view");
  const [t, availability, routes] = await Promise.all([getTranslations("delivery"), myAvailability(ctx), myRoutes(ctx)]);
  // Phase 40: collections of empties planned for this driver
  const { l, locale } = await rtLabels();
  const pickups = await driverPickups(ctx, locale);
  return (
    <>
      <PageHeader title={t("today")} description={<span className="flex flex-wrap items-center gap-2">{t("myStatus")}: <AvailabilitySwitch current={availability} /></span>} />
      <DriverRoutes routes={routes} />
      <DriverList ctx={ctx} period="TODAY" />
      {pickups.length > 0 && (
        <Card className="mt-6" data-testid="driver-pickups">
          <CardHeader><CardTitle>{l.driverPickups}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {pickups.map((p) => (
              <div key={p.id} className="space-y-2 rounded-xl border p-3" data-testid="driver-pickup">
                <p className="text-sm font-medium">{p.customer} <span className="font-mono text-xs text-muted-foreground">{p.number}</span></p>
                <p className="text-xs text-muted-foreground">{p.address}{p.note ? ` · “${p.note}”` : ""}</p>
                <CollectPickupForm l={l} id={p.id} items={p.items} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
