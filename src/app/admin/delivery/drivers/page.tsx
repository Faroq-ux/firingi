import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { allFleets } from "@/server/services/fleet";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DriversTable } from "@/components/delivery/fleet-views";

export const metadata = { title: "Drivers" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"]);
  const manage = can(ctx, "admin.fleet.manage");
  const { drivers } = await allFleets(ctx);
  return (
    <>
      <PageHeader title="Drivers" description="All drivers: FIRINGI fleet and vendor fleets." />
      <Card><CardContent className="pt-5"><DriversTable drivers={drivers} manage={manage} showOwner ownerIsViewer={false} /></CardContent></Card>
    </>
  );
}
