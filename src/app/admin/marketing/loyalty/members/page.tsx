import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listMembers } from "@/server/loyalty/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { LoyaltyTabs } from "@/components/loyalty/admin-tabs";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Loyalty members" };
const TYPE: Record<string, string> = { CUSTOMER: "Customer", WHOLESALER: "Wholesaler" };
const TIER: Record<string, string> = { BRONZE: "Bronze", SILVER: "Silver", GOLD: "Gold" };

export default async function Members() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const rows = await listMembers(ctx);
  return (
    <>
      <PageHeader title="Loyalty members" icon={Gift} description="Every customer and wholesaler with a points account: balance, level, 12-month spend and who they invited. Open one to see its points history or to give or take points (with a reason)." />
      <LoyaltyTabs active="/admin/marketing/loyalty/members" />
      <DataTable tableId="admin.loyalty.members" testId="members-table" empty="No members yet — accounts open with the first delivered order."
        columns={[{ key: "company", label: "Company" }, { key: "type", label: "Type", filter: true }, { key: "country", label: "Country", filter: true }, { key: "tier", label: "Level", type: "badge", filter: true }, { key: "balance", label: "Points", type: "number" }, { key: "earned", label: "Earned in total", type: "number" }, { key: "spend", label: "Spend 12 months", type: "number" }, { key: "referrals", label: "Invited", type: "number" }, { key: "by", label: "Invited by" }]}
        rows={rows.map((m) => ({
          id: m.companyId, href: `/admin/marketing/loyalty/members/${m.companyId}`,
          cells: {
            company: { t: m.name, href: `/admin/marketing/loyalty/members/${m.companyId}` }, type: TYPE[m.type] ?? m.type, country: m.country,
            tier: { t: TIER[m.tier], tone: m.tier === "GOLD" ? "warning" : m.tier === "SILVER" ? "secondary" : "outline" },
            balance: m.balance, earned: m.lifetimeEarned, spend: { t: formatMoney(m.spend12m, "en-GB"), v: Number(m.spend12m) }, referrals: m.referrals, by: m.referredBy ?? "—",
          },
        }))} />
    </>
  );
}
