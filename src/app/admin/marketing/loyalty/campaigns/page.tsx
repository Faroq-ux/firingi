import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { campaignOptions, listCampaigns } from "@/server/loyalty/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LoyaltyTabs } from "@/components/loyalty/admin-tabs";
import { CampaignForm, EndCampaignButton } from "@/components/loyalty/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Bonus campaigns" };

export default async function Campaigns() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const manage = ctx.permissions.has("admin.marketing.manage");
  const [rows, opts] = await Promise.all([listCampaigns(ctx), campaignOptions(ctx)]);
  const vname = new Map(opts.vendors.map((v) => [v.id, v.label]));
  const cname = new Map(opts.categories.map((c) => [c.id, c.label]));
  const now = new Date();
  const state = (r: (typeof rows)[number]) => (!r.active ? "Ended" : r.endsAt <= now ? "Finished" : r.startsAt > now ? "Scheduled" : "Running");
  return (
    <>
      <PageHeader title="Bonus campaigns" icon={Gift} description="More points for a while — on everything, or only on chosen suppliers or categories. Customers see running campaigns in Rewards. The best campaign for each product line applies (no stacking)." />
      <LoyaltyTabs active="/admin/marketing/loyalty/campaigns" />
      {manage && (
        <Card className="mb-4"><CardHeader><CardTitle>New campaign</CardTitle></CardHeader>
          <CardContent><CampaignForm vendors={opts.vendors} categories={opts.categories} /></CardContent></Card>
      )}
      <DataTable tableId="admin.loyalty.campaigns" testId="campaigns-table" empty="No campaigns yet."
        columns={[{ key: "name", label: "Campaign" }, { key: "mult", label: "Points ×", type: "number" }, { key: "when", label: "When" }, { key: "scope", label: "Applies to" }, { key: "state", label: "State", type: "badge", filter: true }, { key: "points", label: "Points given", type: "number" }, { key: "orders", label: "Orders", type: "number" }, { key: "end", label: "" }]}
        rows={rows.map((r) => ({
          id: r.id,
          cells: {
            name: r.name, mult: Number(r.multiplier), when: `${formatDate(r.startsAt, "en-GB")} – ${formatDate(r.endsAt, "en-GB")}`,
            scope: [...r.vendorIds.map((id) => vname.get(id) ?? id), ...r.categoryIds.map((id) => cname.get(id) ?? id), ...(r.offerIds.length ? [`${r.offerIds.length} products`] : [])].join(", ") || "Everything",
            state: { t: state(r), tone: state(r) === "Running" ? "success" : state(r) === "Scheduled" ? "secondary" : "outline" },
            points: r.points, orders: r.orders,
            end: manage && r.active && r.endsAt > now ? { t: "End", node: <EndCampaignButton id={r.id} /> } : "",
          },
        }))} />
    </>
  );
}
