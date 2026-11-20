import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgePercent } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { formOptions, rebateSettings } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { rebateLabels } from "@/components/rebates/labels";
import { allowedFrom } from "@/components/rebates/detail";
import { RebateForm } from "@/components/rebates/client";

export const metadata = { title: "FIRINGI-funded deal" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"]);
  const s = await rebateSettings();
  if (!s.firingiFunded) redirect("/admin/pricing/rebates");
  const [{ l }, options] = await Promise.all([rebateLabels(true), formOptions(ctx)]);
  return (
    <>
      <PageHeader title="FIRINGI-funded deal" icon={BadgePercent} description="A bonus FIRINGI pays for itself on one supplier's goods. It starts as soon as you start it — no supplier money is involved." />
      <Link href="/admin/pricing/rebates" className="mb-3 inline-block text-sm text-primary hover:underline">← Rebates & Bonuses</Link>
      <Card><CardContent className="pt-5"><RebateForm l={l} locale="en" allowed={allowedFrom(s, true)} options={options} suppliers={options.suppliers} detailBase="/admin/pricing/rebates" /></CardContent></Card>
    </>
  );
}
