import { getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { ownFleet, VEHICLE_TYPES } from "@/server/services/fleet";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VehiclesTable } from "@/components/delivery/fleet-views";
import { AddVehicleForm } from "@/components/delivery/delivery-forms";

export const metadata = { title: "Vehicles" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.fleet.view", "vendor.vehicles.manage"]);
  const [fleet, t] = await Promise.all([ownFleet(ctx), getTranslations("delivery")]);
  const manage = can(ctx, "vendor.vehicles.manage");
  return (
    <>
      <PageHeader title={t("vehicles")} description={t("fleetIntro")} actions={manage ? <AddVehicleForm types={[...VEHICLE_TYPES]} /> : undefined} />
      <Card><CardContent className="pt-5"><VehiclesTable vehicles={fleet.vehicles} manage={manage} /></CardContent></Card>
    </>
  );
}
