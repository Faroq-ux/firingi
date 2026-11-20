import { redirect } from "next/navigation";
import { BadgePercent } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { formOptions, rebateSettings, supplierAccess } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { rebateLabels } from "@/components/rebates/labels";
import { allowedFrom } from "@/components/rebates/detail";
import { RebateForm } from "@/components/rebates/client";

export const metadata = { title: "New rebate deal" };
export const dynamic = "force-dynamic";

export default async function NewRebatePage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage", "vendor.pricing.manage"]);
  const s = await rebateSettings();
  if (!(await supplierAccess(ctx.company.id, ctx.company.type, s)).ok) redirect("/vendor/products/rebates");
  const [{ l, locale }, options] = await Promise.all([rebateLabels(), formOptions(ctx)]);
  return (
    <>
      <PageHeader title={l.newDeal} icon={BadgePercent} description={s.approval === "AUTO" ? l.approvalAuto : l.approvalAlways} />
      <Card><CardContent className="pt-5"><RebateForm l={l} locale={locale} allowed={allowedFrom(s, false)} options={options} detailBase="/vendor/products/rebates" /></CardContent></Card>
    </>
  );
}
