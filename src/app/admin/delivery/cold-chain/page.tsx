import { Thermometer } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { ColdFleetOverview } from "@/components/coldchain/overview";
import { enLabels } from "@/components/coldchain/labels";

export const metadata = { title: "Cold Chain" };
export const dynamic = "force-dynamic";

export default async function AdminColdChainPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.fleet.view", "admin.orders.view"]);
  return (
    <>
      <PageHeader title="Cold Chain" icon={Thermometer} description="Temperatures recorded along the way, out-of-range incidents (refused goods are credited by a temperature claim), FIRINGI's fridge units, cold rooms and probes, vehicle data loggers, and the monthly HACCP report." />
      <ColdFleetOverview ctx={ctx} l={enLabels()} locale="en" orderBase="/admin/orders" />
    </>
  );
}
