import { ArrowDownRight, ArrowUpRight, Award, Info, LineChart, Minus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierPriceInsights } from "@/server/price-intel/insights";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { Sparkline } from "@/components/motion/shapes";
import { CancelPriceChange } from "@/components/price-intel/supplier";
import { pickLocalized } from "@/i18n/config";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Price insights" };
const POS_TONE = { CHEAPEST: "success", BELOW_MEDIAN: "default", ABOVE_MEDIAN: "warning", MOST_EXPENSIVE: "destructive" } as const;
const ST_TONE = { PENDING: "warning", APPROVED: "success", APPLIED: "outline", REJECTED: "destructive", CANCELLED: "outline" } as const;

export default async function PriceInsights() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.products.view", "vendor.products.manage"]);
  const [d, t, locale] = await Promise.all([supplierPriceInsights(ctx), getTranslations("priceIntel"), getLocale()]);
  const canManage = ctx.permissions.has("vendor.pricing.manage");
  const name = (n: unknown) => pickLocalized(n as Record<string, string>, locale);
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} icon={LineChart} />
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm" data-testid="price-rule">
        <Info className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>{t("ruleInfo", { pct: d.settings.approvalThresholdPct, days: d.settings.noticeDays })} {t("anonHint", { n: d.settings.minSuppliers })}</p>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Award} label={t("positions.CHEAPEST")} value={d.summary.cheapest} locale={locale} tone="tone-teal" i={0} testId="pos-cheapest" />
        <Tile icon={ArrowDownRight} label={t("positions.BELOW_MEDIAN")} value={d.summary.belowMedian} locale={locale} tone="tone-blue" i={1} />
        <Tile icon={ArrowUpRight} label={t("positions.ABOVE_MEDIAN")} value={d.summary.aboveMedian} locale={locale} tone="tone-orange" i={2} />
        <Tile icon={Minus} label={t("positions.MOST_EXPENSIVE")} value={d.summary.dearest} locale={locale} tone="tone-pink" i={3} hint={t("compared", { n: d.summary.compared, total: d.summary.offers })} />
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>{t("marketTitle")}</CardTitle><CardDescription>{t("marketHint")}</CardDescription></CardHeader>
        <CardContent>
          <DataTable tableId="vendor.price-insights" testId="price-insights" empty={t("noOffers")}
            columns={[{ key: "product", label: t("colProduct") }, { key: "price", label: t("colPrice"), type: "money" }, { key: "median", label: t("colMedian"), type: "money" }, { key: "pos", label: t("colPosition"), type: "badge", filter: true }, { key: "dev", label: t("colVsMedian"), type: "number" }, { key: "trend", label: t("colTrend") }, { key: "tip", label: t("colSuggestion") }]}
            rows={d.rows.map((r) => ({
              id: r.offerId,
              cells: {
                product: { t: name(r.product), sub: `${name(r.packaging)} · ${r.sku}` },
                price: { t: formatMoney(r.price, locale), v: r.price },
                median: r.market ? { t: formatMoney(r.market.median, locale), v: r.market.median } : { t: "—", v: 0 },
                pos: r.market?.position ? { t: t(`positions.${r.market.position}`), tone: POS_TONE[r.market.position] } : { t: t("notCompared"), tone: "outline" },
                dev: r.market ? { t: `${r.market.devPct > 0 ? "+" : ""}${r.market.devPct.toFixed(0)} %`, v: r.market.devPct } : { t: "—", v: 0 },
                trend: { t: "", node: r.history.length > 1 ? <Sparkline values={r.history} label={t("colTrend")} height={28} className="w-24" /> : <span className="text-xs text-muted-foreground">—</span> },
                tip: r.suggestion?.kind === "LOWER" ? t("suggestLower", { price: formatMoney(r.suggestion.to!, locale) }) : r.suggestion?.kind === "BEST" ? t("suggestBest") : r.market ? "—" : t("notEnough", { n: d.settings.minSuppliers }),
              },
            }))} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("requestsTitle")}</CardTitle><CardDescription>{t("requestsHint")}</CardDescription></CardHeader>
        <CardContent>
          <DataTable tableId="vendor.price-requests" testId="price-requests" empty={t("requestsEmpty")}
            columns={[{ key: "product", label: t("colProduct") }, { key: "change", label: t("colChange") }, { key: "status", label: t("colStatus"), type: "badge", filter: true }, { key: "eff", label: t("colApplies"), type: "date" }, { key: "note", label: t("colNote") }, { key: "act", label: "" }]}
            rows={d.requests.map((r) => ({
              id: r.id,
              cells: {
                product: { t: name(r.product), sub: [name(r.packaging), r.list ?? t("basePrices"), r.minQty > 1 ? t("fromQty", { qty: r.minQty }) : null].filter(Boolean).join(" · ") },
                change: `${formatMoney(r.old, locale)} → ${formatMoney(r.new, locale)} (+${r.pct.toFixed(1)} %)`,
                status: { t: t(`statuses.${r.status}`), tone: ST_TONE[r.status] },
                eff: { t: r.effectiveAt ? formatDate(r.effectiveAt, locale) : "—", v: r.effectiveAt?.getTime() ?? 0 },
                note: r.note ?? "—",
                act: { t: "", node: canManage && (r.status === "PENDING" || r.status === "APPROVED") ? <CancelPriceChange id={r.id} /> : null },
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
