import Link from "next/link";
import { Flame } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { dealSettings } from "@/server/deals/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DealSettingsForm } from "@/components/deals/admin";

export const metadata = { title: "Clearance Deal Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"]);
  return (
    <>
      <PageHeader title="Clearance Deal Settings" icon={Flame} description="Which deals suppliers may run, when they start without FIRINGI, the lower commission on clearance deals, best-offer timings and how buyers hear about deals." />
      <Link href="/admin/pricing/deals" className="mb-3 inline-block text-sm text-primary hover:underline">← Clearance Deals</Link>
      <Card><CardContent className="pt-6"><DealSettingsForm initial={await dealSettings()} /></CardContent></Card>
    </>
  );
}
