import Link from "next/link";
import { BadgePercent } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { bonusDetail, companyNames, formOptions, rebateSettings } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rebateLabels } from "@/components/rebates/labels";
import { BonusResults, BonusSummary, allowedFrom, toInitial } from "@/components/rebates/detail";
import { EndBonus, RebateForm, SubmitBonus } from "@/components/rebates/client";

export const metadata = { title: "Rebate deal" };
export const dynamic = "force-dynamic";

export default async function VendorRebatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage", "vendor.pricing.manage", "vendor.reports.view"]);
  const [{ l, locale }, d, s] = await Promise.all([rebateLabels(), bonusDetail(ctx, id), rebateSettings()]);
  const b = d.bonus;
  const canEdit = ctx.permissions.has("vendor.promotions.manage") || ctx.permissions.has("vendor.pricing.manage");
  const editable = canEdit && (b.status === "DRAFT" || b.status === "REJECTED");
  const running = b.status === "APPROVED" && b.validFrom <= new Date();
  const options = editable ? await formOptions(ctx) : null;
  return (
    <>
      <PageHeader title={b.name} icon={BadgePercent} description={<Link href="/vendor/products/rebates" className="text-primary hover:underline">← {l.back}</Link>} />
      <BonusSummary l={l} locale={locale} d={d} />
      {canEdit && ["DRAFT", "PENDING", "REJECTED", "APPROVED"].includes(b.status) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {editable && <SubmitBonus l={l} id={b.id} auto={s.approval === "AUTO"} />}
          {(b.status !== "APPROVED" || !b.validTo || b.validTo > new Date()) && <EndBonus l={l} id={b.id} running={running} />}
        </div>
      )}
      {editable && options && (
        <Card className="mb-4">
          <CardHeader><CardTitle>{l.editDeal}</CardTitle></CardHeader>
          <CardContent><RebateForm l={l} locale={locale} allowed={allowedFrom(s, false)} options={options} initial={toInitial(b, await companyNames(b.companyIds))} detailBase="/vendor/products/rebates" /></CardContent>
        </Card>
      )}
      <BonusResults l={l} locale={locale} d={d} />
    </>
  );
}
