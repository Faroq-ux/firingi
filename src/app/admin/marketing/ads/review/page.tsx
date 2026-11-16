import Link from "next/link";
import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCampaigns } from "@/server/ads/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { AdsTabs, ReviewButtons } from "@/components/ads/admin";
import { PLACEMENT_LABEL } from "@/components/ads/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Ads to review" };
export const dynamic = "force-dynamic";

export default async function AdsReview() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const rows = await listCampaigns(ctx, { status: "PENDING" });
  const manage = ctx.permissions.has("admin.marketing.manage");
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "open");
  return (
    <>
      <PageHeader title="Ads to review" icon={Megaphone} description="New campaigns wait here until FIRINGI approves them. Check the products and the search words; a rejection reason is sent to the supplier." />
      <AdsTabs active="/admin/marketing/ads/review" pending={rows.length} />
      <DataTable tableId="admin.ads.review" testId="review-table" empty="Nothing to review."
        columns={[{ key: "campaign", label: "Campaign" }, { key: "supplier", label: "Supplier" }, { key: "placement", label: "Where", filter: true }, { key: "price", label: "Price" }, { key: "dates", label: "Dates" }, { key: "words", label: "Search words" }, { key: "actions", label: "" }]}
        rows={rows.map((c) => ({
          id: c.id,
          cells: {
            campaign: { t: c.name, node: <Link className="font-medium text-primary hover:underline" href={`/admin/marketing/ads/campaigns/${c.id}`}>{c.name}</Link>, sub: `${c.offerIds.length} product(s)` },
            supplier: c.vendorName, placement: PLACEMENT_LABEL[c.placement],
            price: c.pricing === "CPC" ? `${formatMoney(c.cpcBid!.toString(), "en-GB")}/click · ${formatMoney(c.dailyBudget!.toString(), "en-GB")}/day` : `${formatMoney(c.dailyPrice!.toString(), "en-GB")}/day (booked)`,
            dates: `${d(c.startsOn)} → ${d(c.endsOn)}`, words: c.keywords.join(", ") || "—",
            actions: manage ? { t: "", node: <ReviewButtons id={c.id} /> } : "",
          },
        }))} />
    </>
  );
}
