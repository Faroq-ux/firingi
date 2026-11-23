import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { siteDetail } from "@/server/consignment/service";
import { PageHeader } from "@/components/layout/page-header";
import { SiteStatus, SiteView } from "@/components/consignment/views";
import { csLabels } from "@/components/consignment/labels";

export const metadata = { title: "Consignment" };
export const dynamic = "force-dynamic";

export default async function VendorConsignmentSitePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.consignment.manage", "vendor.consignment.count"]);
  const { id } = await params;
  const [{ l, locale }, s] = await Promise.all([csLabels(), siteDetail(ctx, id).catch(() => null)]);
  if (!s || s.side !== "VENDOR") notFound();
  return (
    <>
      <PageHeader title={`${s.customer} · ${s.number}`} description={`${l.warehouse}: ${s.warehouse}`} icon={Boxes}
        actions={<div className="flex flex-wrap items-center gap-2"><SiteStatus l={l} status={s.status} /><Link href="/vendor/consignment" className="text-sm underline-offset-2 hover:underline">{l.back}</Link></div>} />
      <SiteView l={l} locale={locale} s={s} />
    </>
  );
}
