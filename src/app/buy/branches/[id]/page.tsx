import Link from "next/link";
import { MapPin, Receipt, ShoppingBag, Store, Users, Wallet } from "lucide-react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getBranch, shopCities, teamOptions, unassignedAddresses } from "@/server/multisite/branches";
import { listBudgets } from "@/server/multisite/budgets";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { AssignAddress, BudgetBar, RemoveAddress, ShopActions, ShopAddressForm, ShopForm, ShopStaff } from "@/components/multisite/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Shop" };

export default async function Shop({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.branches.manage", "buyer.orders.view", "buyer.orders.place", "buyer.reports.view"]);
  const { id } = await params;
  const manager = ctx.permissions.has("buyer.branches.manage");
  const [t, tb, to, locale] = await Promise.all([getTranslations("multisite"), getTranslations("onboarding"), getTranslations("orders"), getLocale()]);
  const b = await getBranch(ctx, id).catch(() => null);
  if (!b) notFound();
  const [budgets, team, free, geo] = await Promise.all([
    listBudgets(ctx), manager ? teamOptions(ctx) : Promise.resolve([]), manager ? unassignedAddresses(ctx) : Promise.resolve([]), manager ? shopCities(ctx) : Promise.resolve({ countryCode: "PT", cities: [] }),
  ]);
  const own = budgets.filter((x) => x.branchId === id || x.branchId === null);
  const monthSpend = b.orders.filter((o) => o.placedAt >= new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) && o.status !== "CANCELLED").reduce((a, o) => a + Number(o.grandTotal), 0);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={b.name} icon={Store}
        description={<span className="flex flex-wrap items-center gap-2">{b.category && <Badge variant="secondary" data-testid="shop-category">{tb(`businessTypes.${b.category}`)}</Badge>}{b.code && <Badge variant="outline">{b.code}</Badge>}{b.costCentre && <span>{t("costCentre")}: <b>{b.costCentre}</b></span>}{!b.isActive && <Badge variant="outline">{t("inactive")}</Badge>}</span>}
        actions={manager ? <ShopActions id={b.id} isActive={b.isActive} /> : undefined} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={MapPin} label={t("addresses")} value={b.addresses.length} locale={locale} tone="tone-blue" i={0} />
        <Tile icon={Users} label={t("staff")} value={b.members.length} locale={locale} tone="tone-teal" i={1} hint={b.manager ? `${t("manager")}: ${b.manager}` : undefined} />
        <Tile icon={ShoppingBag} label={t("recentOrders")} value={b.orders.length} locale={locale} tone="tone-violet" i={2} />
        <Tile icon={Receipt} label={t("spendThisMonth")} value={monthSpend} fmt="money" locale={locale} tone="tone-orange" i={3} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("shopAddresses")}</CardTitle><CardDescription>{t("shopAddressesHint")}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {b.addresses.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAddresses")}</p> : (
              <ul className="divide-y rounded-xl border" data-testid="shop-addresses">
                {b.addresses.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0"><span className="font-medium">{a.label}</span><span className="block text-muted-foreground">{a.line1}, {a.postalCode} {a.cityName}</span></span>
                    {manager && <RemoveAddress addressId={a.id} />}
                  </li>
                ))}
              </ul>
            )}
            {manager && <ShopAddressForm branchId={b.id} cities={geo.cities} countryCode={geo.countryCode} />}
            {manager && <AssignAddress branchId={b.id} addresses={free.map((a) => ({ id: a.id, label: `${a.label} — ${a.line1}, ${a.cityName}` }))} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("staffTitle")}</CardTitle><CardDescription>{t("staffIntro")}</CardDescription></CardHeader>
          <CardContent>
            {manager ? <ShopStaff branchId={b.id} members={b.members} team={team} /> : (
              <ul className="space-y-1 text-sm">{b.members.map((m) => <li key={m.membershipId}>{m.name} <span className="text-muted-foreground">· {m.email}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="size-4" />{t("budgets")}</CardTitle><CardDescription>{t("shopBudgetsHint")}</CardDescription></CardHeader>
          <CardContent className="space-y-3" data-testid="shop-budgets">
            {own.length === 0 ? <p className="text-sm text-muted-foreground">{t("noBudgets")}</p> : own.map((x) => (
              <div key={x.id} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium">{x.name} <span className="text-xs font-normal text-muted-foreground">· {x.branch ?? t("wholeCompany")} · {t(`per.${x.period}`)}</span></span><span className="tabular-nums text-xs">{formatMoney(x.spent, locale)} / {formatMoney(x.amount, locale)}</span></div>
                <BudgetBar pct={x.pct} label={`${x.name}: ${x.pct}%`} />
              </div>
            ))}
            {manager && <Link href="/buy/branches/budgets" className="text-sm font-medium text-primary hover:underline">{t("manageBudgets")} →</Link>}
          </CardContent>
        </Card>
        {manager && (
          <Card>
            <CardHeader><CardTitle>{t("details")}</CardTitle></CardHeader>
            <CardContent><ShopForm initial={b} team={team} cities={geo.cities} countryCode={geo.countryCode} /></CardContent>
          </Card>
        )}
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">{t("recentOrders")}</h2>
      <DataTable tableId="buy.shop.orders" testId="shop-orders" empty={t("noOrders")}
        columns={[{ key: "number", label: to("order") }, { key: "date", label: t("date"), type: "date" }, { key: "supplier", label: t("supplier") }, { key: "po", label: t("poReference") }, { key: "total", label: t("total"), type: "money" }, { key: "status", label: t("status"), type: "badge" }]}
        rows={b.orders.map((o) => ({
          id: o.id, href: `/buy/orders/${o.id}`,
          cells: { number: { t: o.number, mono: true, href: `/buy/orders/${o.id}` }, date: { t: date.format(o.placedAt), v: o.placedAt.toISOString() }, supplier: o.supplier, po: o.poReference ?? "—", total: { t: formatMoney(o.grandTotal, locale), v: Number(o.grandTotal) }, status: { t: to(`statuses.${o.status}`), tone: "outline" } },
        }))} />
    </>
  );
}
