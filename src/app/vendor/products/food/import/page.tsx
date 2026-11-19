import Link from "next/link";
import { ArrowLeft, FileUp } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FoodImport } from "@/components/food/client";
import { foodLabels } from "@/components/food/labels";

export const metadata = { title: "Import Food Information" };
export const dynamic = "force-dynamic";

/** Phase 44: food information from a spreadsheet (FIRINGI template or GS1 / GDSN headers). */
export default async function VendorFoodImportPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.products.manage");
  const { l } = await foodLabels();
  return (
    <>
      <Link href="/vendor/products/food" className="mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-4" /> {l.back}</Link>
      <PageHeader title={l.importTitle} icon={FileUp} description={l.importIntro} />
      <Card><CardContent className="pt-4"><FoodImport l={l} /></CardContent></Card>
    </>
  );
}
