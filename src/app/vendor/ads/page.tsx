import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone, Plus } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myAds } from "@/server/ads/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Advertising" };
export const dynamic = "force-dynamic";
const TONE = { PENDING: "warning", ACTIVE: "success", PAUSED: "secondary", REJECTED: "destructive", ENDED: "outline" } as const;

export default async function MyAds() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.promotions.manage");
  const [r, t, locale] = await Promise.all([myAds(ctx).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; }), getTranslations("ads"), getLocale()]);
  const money = (v: string | number) => formatMoney(String(v), locale);
  const kpis: [string, string, string][] = [
    [t("spentMonth"), money(r.spentMonth), "kpi-spent"],
    [t("running"), String(r.rows.filter((x) => x.status === "ACTIVE").length), "kpi-running"],
    [t("billing"), t(`billings.${r.account.billing}`), "kpi-billing"],
    ...(r.account.billing === "PREPAID" || Number(r.account.balance) > 0 ? [[t("balance"), money(r.account.balance), "kpi-balance"] as [string, string, string]] : []),
  ];
  return (
    <>
      <PageHeader title={t("title")} icon={Megaphone} description={t("description")}
        actions={<Link href="/vendor/ads/new" className={buttonVariants()} data-testid="new-ad"><Plus className="size-4" /> {t("newAd")}</Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ads-kpis">
        {kpis.map(([l, v, id]) => <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l}</p><p className="kpi-value text-xl font-semibold" data-testid={id}>{v}</p></CardContent></Card>)}
      </div>
      <DataTable tableId="vendor.ads" testId="my-ads-table" empty={t("noAds")}
        columns={[{ key: "ad", label: t("colAd") }, { key: "where", label: t("colWhere"), filter: true }, { key: "price", label: t("colPrice") }, { key: "status", label: t("colStatus"), type: "badge", filter: true }, { key: "impressions", label: t("colImpressions"), type: "number" }, { key: "clicks", label: t("colClicks"), type: "number" }, { key: "ctr", label: t("colCtr"), type: "number" }, { key: "spent", label: t("colSpent"), type: "number" }, { key: "orders", label: t("colOrders"), type: "number" }]}
        rows={r.rows.map((c) => ({
          id: c.id, href: `/vendor/ads/${c.id}`,
          cells: {
            ad: { t: c.name, href: `/vendor/ads/${c.id}` }, where: t(`placements.${c.placement}`),
            price: c.pricing === "CPC" ? t("perClickBudget", { price: money(c.cpcBid!.toString()), budget: money(c.dailyBudget!.toString()) }) : t("perDay", { price: money(c.dailyPrice!.toString()) }),
            status: { t: t(`statuses.${c.status}`), tone: TONE[c.status], sub: c.pausedReason && c.status !== "ACTIVE" ? t(`reasons.${c.pausedReason}`) : undefined },
            impressions: c.impressions, clicks: c.clicks, ctr: { t: `${(c.ctr * 100).toFixed(1)} %`, v: c.ctr }, spent: { t: money(c.cost), v: Number(c.cost) }, orders: c.orders,
          },
        }))} />
    </>
  );
}
