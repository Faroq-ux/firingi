import { Building2, ClipboardCheck, Receipt, ShoppingBag, Store } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listBranches, orderingSettings, shopCities, teamOptions } from "@/server/multisite/branches";
import { pendingApprovalCount } from "@/server/buying/approvals";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { PoRequiredToggle, ShopForm } from "@/components/multisite/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Shops" };

export default async function Shops() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.branches.manage", "buyer.orders.view", "buyer.orders.place", "buyer.reports.view"]);
  const manager = ctx.permissions.has("buyer.branches.manage");
  const [t, tb, locale, rows, pending, ordering] = await Promise.all([getTranslations("multisite"), getTranslations("onboarding"), getLocale(), listBranches(ctx), pendingApprovalCount(ctx), orderingSettings(ctx)]);
  const [team, geo] = manager ? await Promise.all([teamOptions(ctx), shopCities(ctx)]) : [[], { countryCode: "PT", cities: [] }];
  const spend = rows.reduce((a, r) => a + Number(r.monthSpend), 0);
  const orders = rows.reduce((a, r) => a + r.monthOrders, 0);
  return (
    <>
      <PageHeader title={t("shopsTitle")} description={t("shopsIntro")} icon={Store} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Building2} label={t("shops")} value={rows.filter((r) => r.isActive).length} locale={locale} tone="tone-blue" i={0} testId="kpi-shops" />
        <Tile icon={Receipt} label={t("spendThisMonth")} value={spend} fmt="money" locale={locale} tone="tone-violet" i={1} />
        <Tile icon={ShoppingBag} label={t("ordersThisMonth")} value={orders} locale={locale} tone="tone-teal" i={2} />
        <Tile icon={ClipboardCheck} label={t("pendingApprovals")} value={pending} locale={locale} tone="tone-orange" i={3} href="/buy/orders/approvals" />
      </div>
      <DataTable tableId="buy.shops" testId="shops-table" empty={manager ? t("noShopsManager") : t("noShops")}
        columns={[{ key: "name", label: t("shop") }, { key: "category", label: t("category"), filter: true }, { key: "manager", label: t("manager") }, { key: "addresses", label: t("addresses"), type: "number" }, { key: "staff", label: t("staff"), type: "number" }, { key: "orders", label: t("ordersThisMonth"), type: "number" }, { key: "spend", label: t("spendThisMonth"), type: "money" }, { key: "status", label: t("status"), type: "badge", filter: true }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/buy/branches/${r.id}`,
          cells: {
            name: { t: r.name, href: `/buy/branches/${r.id}`, sub: [r.code, r.costCentre].filter(Boolean).join(" · ") || undefined }, category: r.category ? tb(`businessTypes.${r.category}`) : "—", manager: r.manager ?? "—",
            addresses: r.addresses, staff: r.members, orders: r.monthOrders, spend: { t: formatMoney(r.monthSpend, locale), v: Number(r.monthSpend) },
            status: { t: r.isActive ? t("active") : t("inactive"), tone: r.isActive ? "success" : "outline" },
          },
        }))} />
      {manager && (
        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>{t("newShop")}</CardTitle><CardDescription>{t("newShopHint")}</CardDescription></CardHeader>
            <CardContent><ShopForm team={team} cities={geo.cities} countryCode={geo.countryCode} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("orderingRules")}</CardTitle><CardDescription>{t("orderingRulesHint")}</CardDescription></CardHeader>
            <CardContent><PoRequiredToggle required={ordering.requirePoReference} /></CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
