import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { allFleets, ownFleet, VEHICLE_TYPES } from "@/server/services/fleet";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VehiclesTable } from "@/components/delivery/fleet-views";
import { AddVehicleForm } from "@/components/delivery/delivery-forms";

export const metadata = { title: "Vehicle Management" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"]);
  const manage = can(ctx, "admin.fleet.manage");
  const [own, all] = await Promise.all([ownFleet(ctx), allFleets(ctx, { owner: "VENDORS" })]);
  return (
    <>
      <PageHeader title="Vehicle Management" description="FIRINGI's vehicles, and the vehicles vendors registered for their own deliveries." actions={manage ? <AddVehicleForm types={[...VEHICLE_TYPES]} /> : undefined} />
      <Card className="mb-4"><CardHeader><CardTitle>FIRINGI fleet</CardTitle></CardHeader><CardContent><VehiclesTable vehicles={own.vehicles} manage={manage} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Vendor fleets</CardTitle></CardHeader><CardContent><VehiclesTable vehicles={all.vehicles} manage={manage} showOwner asFiringiOverVendor={() => true} /></CardContent></Card>
    </>
  );
}
