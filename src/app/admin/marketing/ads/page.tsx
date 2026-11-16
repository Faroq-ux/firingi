import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adsOverview } from "@/server/ads/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdsSettingsForm, AdsTabs, RunAdsButton } from "@/components/ads/admin";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Sponsored Products" };
export const dynamic = "force-dynamic";

export default async function AdsAdmin() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.finance.view", "admin.finance.manage"]);
  const o = await adsOverview(ctx);
  const manage = ctx.permissions.has("admin.marketing.manage");
  const kpis: [string, string, string][] = [
    ["Ad revenue this month (excl. VAT)", formatMoney(o.revenueMonth, "en-GB"), "kpi-revenue"],
    ["Running campaigns", String(o.active), "kpi-active"],
    ["Waiting for approval", String(o.pending), "kpi-pending"],
    ["Impressions this month", o.impressions.toLocaleString("en-GB"), "kpi-impressions"],
    ["Clicks this month", o.clicks.toLocaleString("en-GB"), "kpi-clicks"],
    ["Click rate", `${(o.ctr * 100).toFixed(1)} %`, "kpi-ctr"],
    ["Invoiced this month (incl. VAT)", formatMoney(o.invoicedMonth, "en-GB"), "kpi-invoiced"],
    ["Prepaid balances held", formatMoney(o.prepaidBalance, "en-GB"), "kpi-prepaid"],
  ];
  return (
    <>
      <PageHeader title="Sponsored Products" icon={Megaphone} actions={manage ? <RunAdsButton /> : undefined}
        description="Suppliers pay FIRINGI to show their products higher up: in search results, on category pages, on the shop home and as cart suggestions — marked 'Sponsored' for buyers. Per click (with budgets) or per booked day. How FIRINGI collects is agreed per supplier: deducted from payouts, prepaid balance or monthly invoice." />
      <AdsTabs active="/admin/marketing/ads" pending={o.pending} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ads-kpis">
        {kpis.map(([label, value, id]) => (
          <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="kpi-value text-2xl font-semibold tabular-nums" data-testid={id}>{value}</p></CardContent></Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Placements & rules</CardTitle></CardHeader>
        <CardContent><AdsSettingsForm settings={o.settings} canManage={manage} /></CardContent>
      </Card>
    </>
  );
}
