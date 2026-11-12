import { getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { featureOn } from "@/server/warehouse/features";
import { FeatureOff } from "@/components/warehouse/feature-off";
import { listBins } from "@/server/warehouse/bins";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ScanConsole } from "@/components/warehouse/controls";

export const metadata = { title: "Scanner" };

export default async function ScanPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"]);
  const t = await getTranslations("warehouse");
  if (!(await featureOn(ctx, "PICK_PACK", "BINS"))) return <FeatureOff title={t("scanTitle")} />;
  const shelvesOn = await featureOn(ctx, "BINS");
  const bins = shelvesOn ? (await listBins(ctx)).filter((b) => b.isActive) : [];
  const byWh: Record<string, { id: string; label: string }[]> = {};
  for (const b of bins) (byWh[b.addressId] ??= []).push({ id: b.id, label: b.code });
  return (
    <>
      <PageHeader title={t("scanTitle")} description={t("scanIntro")} />
      <Card className="mx-auto max-w-2xl"><CardContent className="pt-6"><ScanConsole binsByWarehouse={byWh} canMove={shelvesOn && can(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage"])} /></CardContent></Card>
    </>
  );
}
