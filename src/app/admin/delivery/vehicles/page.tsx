import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { allFleets } from "@/server/services/fleet";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VehiclesTable } from "@/components/delivery/fleet-views";

export const metadata = { title: "Vehicles" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"]);
  const { vehicles } = await allFleets(ctx);
  return (
    <>
      <PageHeader title="Vehicles" description="All vehicles: FIRINGI fleet and vendor fleets." />
      <Card><CardContent className="pt-5"><VehiclesTable vehicles={vehicles} manage={false} showOwner /></CardContent></Card>
    </>
  );
}
