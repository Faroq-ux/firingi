import Link from "next/link";
import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCampaigns } from "@/server/ads/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { AdsTabs } from "@/components/ads/admin";
import { PLACEMENT_LABEL } from "@/components/ads/labels";
import { formatMoney } from "@/lib/utils";
import { STATUS } from "@/components/ads/labels";

export const metadata = { title: "Ad campaigns" };
export const dynamic = "force-dynamic";

export default async function AdsCampaigns() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.finance.view", "admin.finance.manage"]);
  const rows = await listCampaigns(ctx);
  return (
    <>
      <PageHeader title="Ad campaigns" icon={Megaphone} description="Every supplier campaign with its results. Open one to see it day by day, or to pause or end it." />
      <AdsTabs active="/admin/marketing/ads/campaigns" pending={rows.filter((r) => r.status === "PENDING").length} />
      <DataTable tableId="admin.ads.campaigns" testId="campaigns-table" empty="No campaigns yet."
        columns={[{ key: "campaign", label: "Campaign" }, { key: "supplier", label: "Supplier", filter: true }, { key: "placement", label: "Where", filter: true }, { key: "pricing", label: "Pricing", filter: true }, { key: "status", label: "Status", type: "badge", filter: true }, { key: "impressions", label: "Impressions", type: "number" }, { key: "clicks", label: "Clicks", type: "number" }, { key: "cost", label: "Spent", type: "number" }]}
        rows={rows.map((c) => ({
          id: c.id, href: `/admin/marketing/ads/campaigns/${c.id}`,
          cells: {
            campaign: { t: c.name, node: <Link className="font-medium text-primary hover:underline" href={`/admin/marketing/ads/campaigns/${c.id}`}>{c.name}</Link> },
            supplier: c.vendorName, placement: PLACEMENT_LABEL[c.placement], pricing: c.pricing === "CPC" ? "Per click" : "Per day",
            status: { t: STATUS[c.status][0], tone: STATUS[c.status][1] }, impressions: c.impressions, clicks: c.clicks, cost: { t: formatMoney(c.cost, "en-GB"), v: Number(c.cost) },
          },
        }))} />
    </>
  );
}
