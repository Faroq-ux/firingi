import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { allFleets } from "@/server/services/fleet";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DriversTable } from "@/components/delivery/fleet-views";

export const metadata = { title: "Driver Availability" };
const ORDER = { AVAILABLE: 0, BUSY: 1, OFF_DUTY: 2 } as const;

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"]);
  const { drivers } = await allFleets(ctx);
  const active = drivers.filter((d) => d.status === "APPROVED").sort((a, b) => ORDER[a.availability] - ORDER[b.availability]);
  const n = (a: keyof typeof ORDER) => active.filter((d) => d.availability === a).length;
  return (
    <>
      <PageHeader title="Driver Availability" description={`${n("AVAILABLE")} available · ${n("BUSY")} on a delivery · ${n("OFF_DUTY")} off duty`} />
      <Card><CardContent className="pt-5"><DriversTable drivers={active} manage={false} showOwner /></CardContent></Card>
    </>
  );
}
