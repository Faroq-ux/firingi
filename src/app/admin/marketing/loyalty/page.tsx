import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { loyaltyOverview } from "@/server/loyalty/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoyaltyTabs } from "@/components/loyalty/admin-tabs";
import { LoyaltySettingsForm, RunNowButton } from "@/components/loyalty/admin";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Loyalty & Rewards" };

export default async function LoyaltyAdmin() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const o = await loyaltyOverview(ctx);
  const manage = ctx.permissions.has("admin.marketing.manage");
  const n = (v: number) => v.toLocaleString("en-GB");
  const kpis: [string, string, string][] = [
    ["Members", n(o.accounts), "kpi-members"],
    ["Points outstanding", n(o.balance), "kpi-balance"],
    ["Value outstanding (FIRINGI owes)", formatMoney(o.liability, "en-GB"), "kpi-liability"],
    ["Paid with points so far", formatMoney(o.redeemedEuros, "en-GB"), "kpi-redeemed"],
    ["Earned this month", n((o.month.EARN ?? 0) + (o.month.REFERRAL ?? 0) + (o.month.BONUS ?? 0)), "kpi-earned"],
    ["Spent this month", n(-((o.month.REDEEM_ORDER ?? 0) + (o.month.REDEEM_CREDIT ?? 0) + (o.month.REDEEM_REWARD ?? 0))), "kpi-spent"],
    ["Expired this month", n(-(o.month.EXPIRE ?? 0)), "kpi-expired"],
  ];
  return (
    <>
      <PageHeader title="Loyalty & Rewards" icon={Gift} actions={manage ? <RunNowButton /> : undefined}
        description="Customers and wholesalers earn points on delivered goods and spend them as a discount at checkout or as a credit note. FIRINGI pays for every reward — supplier payouts never change. Points used show in Marketing Analytics as the 'Loyalty points' promotion and lower FIRINGI's margin on those orders." />
      <LoyaltyTabs active="/admin/marketing/loyalty" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="loyalty-kpis">
        {kpis.map(([label, value, id]) => (
          <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="kpi-value text-2xl font-semibold tabular-nums" data-testid={id}>{value}</p></CardContent></Card>
        ))}
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Members by level</p>
          <p className="text-sm" data-testid="kpi-tiers">Bronze <b>{o.tiers.BRONZE}</b> · Silver <b>{o.tiers.SILVER}</b> · Gold <b>{o.tiers.GOLD}</b></p></CardContent></Card>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent><LoyaltySettingsForm settings={o.settings} canManage={manage} /></CardContent>
      </Card>
    </>
  );
}
