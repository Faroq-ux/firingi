import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adsSettings, campaignDetail } from "@/server/ads/service";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { BudgetForm, CampaignActions } from "@/components/ads/vendor";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Ad" };
export const dynamic = "force-dynamic";
const TONE = { PENDING: "warning", ACTIVE: "success", PAUSED: "secondary", REJECTED: "destructive", ENDED: "outline" } as const;

export default async function AdDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.promotions.manage");
  const [r, t, locale, s] = await Promise.all([campaignDetail(ctx, (await params).id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; }), getTranslations("ads"), getLocale(), adsSettings()]);
  const c = r.campaign;
  const money = (v: string | number) => formatMoney(String(v), locale);
  const kpis: [string, string][] = [[t("colImpressions"), r.totals.impressions.toLocaleString(locale)], [t("colClicks"), r.totals.clicks.toLocaleString(locale)], [t("colCtr"), `${(r.totals.ctr * 100).toFixed(1)} %`], [t("colSpent"), money(r.totals.cost)], [t("colOrders"), String(r.totals.orders)], [t("revenue"), money(r.totals.revenue)]];
  return (
    <>
      <PageHeader title={c.name} icon={Megaphone} description={`${t(`placements.${c.placement}`)} · ${c.pricing === "CPC" ? t("perClickBudget", { price: money(c.cpcBid!.toString()), budget: money(c.dailyBudget!.toString()) }) : t("perDay", { price: money(c.dailyPrice!.toString()) })}`}
        actions={<CampaignActions id={c.id} status={c.status} pausedReason={c.pausedReason} />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={TONE[c.status]} data-testid="ad-status">{t(`statuses.${c.status}`)}</Badge>
        {c.pausedReason && c.status !== "ACTIVE" && <span className="text-sm text-muted-foreground">{t(`reasons.${c.pausedReason}`)}</span>}
        <span className="text-sm text-muted-foreground">{c.startsOn.toISOString().slice(0, 10)} → {c.endsOn ? c.endsOn.toISOString().slice(0, 10) : "…"}</span>
      </div>
      {c.status === "REJECTED" && c.rejectReason && <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive" data-testid="ad-rejected">{t("rejected", { reason: c.rejectReason })}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="ad-kpis">
        {kpis.map(([l, v]) => <Card key={l}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l}</p><p className="kpi-value text-xl font-semibold tabular-nums">{v}</p></CardContent></Card>)}
      </div>
      {c.pricing === "CPC" && (!["ENDED", "REJECTED"].includes(c.status) || c.pausedReason === "BUDGET") && (
        <Card className="mb-4"><CardHeader><CardTitle>{t("changeBudget")}</CardTitle></CardHeader><CardContent>
          <BudgetForm id={c.id} cpcBid={c.cpcBid!.toString()} dailyBudget={c.dailyBudget!.toString()} totalBudget={c.totalBudget?.toString() ?? null} minCpc={s.placements[c.placement].minCpc} />
        </CardContent></Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card><CardHeader><CardTitle>{t("productsTitle")}</CardTitle></CardHeader><CardContent>
          <ul className="space-y-1 text-sm">{r.offers.map((o) => <li key={o.id} className="break-words">{pickLocalized(o.name, locale)} — {pickLocalized(o.pack, locale)} <span className="font-mono text-xs text-muted-foreground">{o.sku}</span></li>)}</ul>
          {c.keywords.length > 0 && <p className="mt-3 text-sm"><span className="text-muted-foreground">{t("keywords")}:</span> {c.keywords.join(", ")}</p>}
        </CardContent></Card>
        <DataTable tableId="vendor.ads.days" testId="ad-days" empty={t("noDays")}
          columns={[{ key: "day", label: t("colDay"), type: "date" }, { key: "impressions", label: t("colImpressions"), type: "number" }, { key: "clicks", label: t("colClicks"), type: "number" }, { key: "cost", label: t("colSpent"), type: "number" }]}
          rows={r.days.map((d) => ({ id: d.day, cells: { day: d.day, impressions: d.impressions, clicks: d.clicks, cost: { t: money(d.cost), v: Number(d.cost) } } }))} />
      </div>
    </>
  );
}
