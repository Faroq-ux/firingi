import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { ownFleet } from "@/server/services/fleet";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DriversTable } from "@/components/delivery/fleet-views";
import { AddDriverForm } from "@/components/delivery/delivery-forms";

export const metadata = { title: "FIRINGI Drivers" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"]);
  const manage = can(ctx, "admin.fleet.manage");
  const fleet = await ownFleet(ctx);
  return (
    <>
      <PageHeader title="FIRINGI Drivers" description="Drivers of FIRINGI's own fleet. Added here they are active at once; independent applicants go through Driver Applications." actions={manage ? <AddDriverForm /> : undefined} />
      <Card><CardContent className="pt-5"><DriversTable drivers={fleet.drivers} manage={manage} /></CardContent></Card>
    </>
  );
}
