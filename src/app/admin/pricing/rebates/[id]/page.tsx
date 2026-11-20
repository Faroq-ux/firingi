import Link from "next/link";
import { BadgePercent } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { bonusDetail } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { rebateLabels } from "@/components/rebates/labels";
import { BonusResults, BonusSummary } from "@/components/rebates/detail";
import { EndBonus, SubmitBonus } from "@/components/rebates/client";
import { ReviewBonus } from "@/components/rebates/admin";

export const metadata = { title: "Rebate deal" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage", "admin.vendors.view", "admin.finance.view"]);
  const [{ l }, d] = await Promise.all([rebateLabels(true), bonusDetail(ctx, id)]);
  const b = d.bonus;
  const manage = ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"].some((p) => ctx.permissions.has(p as never));
  return (
    <>
      <PageHeader title={b.name} icon={BadgePercent} description={<span>{b.seller.tradeName ?? b.seller.legalName} · <Link href="/admin/pricing/rebates" className="text-primary hover:underline">← Rebates & Bonuses</Link></span>} />
      <BonusSummary l={l} locale="en" d={d} admin />
      {manage && (
        <div className="mb-4 flex flex-wrap items-start gap-3">
          {b.status === "PENDING" && <ReviewBonus id={b.id} />}
          {b.fundedBy === "FIRINGI" && ["DRAFT", "REJECTED"].includes(b.status) && <SubmitBonus l={l} id={b.id} auto />}
          {["DRAFT", "PENDING", "REJECTED", "APPROVED"].includes(b.status) && (b.status !== "APPROVED" || !b.validTo || b.validTo > new Date()) && <EndBonus l={l} id={b.id} running={b.status === "APPROVED" && b.validFrom <= new Date()} />}
        </div>
      )}
      <BonusResults l={l} locale="en" d={d} admin />
    </>
  );
}
