import { Thermometer } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { ColdFleetOverview } from "@/components/coldchain/overview";
import { ccLabels } from "@/components/coldchain/labels";

export const metadata = { title: "Cold Chain" };
export const dynamic = "force-dynamic";

export default async function VendorColdChainPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage", "vendor.fleet.view", "vendor.inventory.view"]);
  const { l, locale } = await ccLabels();
  return (
    <>
      <PageHeader title={l.fleetTitle} icon={Thermometer} description={l.fleetIntro} />
      <ColdFleetOverview ctx={ctx} l={l} locale={locale} orderBase="/vendor/orders" />
    </>
  );
}
