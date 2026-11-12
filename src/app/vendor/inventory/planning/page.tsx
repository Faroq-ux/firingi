import Link from "next/link";
import { AlertOctagon, CalendarClock, Gauge, Hourglass, PackageX, Layers, TrendingUp } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { myDashboard } from "@/server/planning/service";
import { rowLabel } from "@/server/planning/engine";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { AccuracyChart } from "@/components/planning/forecast-chart";
import { RecalcButton } from "@/components/planning/vendor";
import { URGENCY_TONE } from "@/lib/planning";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Planning" };
const B = "/vendor/inventory/planning";

export default async function PlanningOverview() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [d, t, locale] = await Promise.all([myDashboard(ctx), getTranslations("planning"), getLocale()]);
  const n = (u: string) => d.open.filter((s) => s.urgency === u).length;
  const expiry = d.risk.filter((r) => r.kind === "EXPIRY").reduce((a, r) => a + r.value, 0);
  const over = d.risk.filter((r) => r.kind === "OVERSTOCK").reduce((a, r) => a + r.value, 0);
  const acc = d.accuracy.overall;
  const methods = d.cp.rows.filter((r) => r.fit.weeksOfHistory > 0).reduce((m, r) => ({ ...m, [r.fit.method]: (m[r.fit.method] ?? 0) + 1 }), {} as Record<string, number>);
  const act = can(ctx, ["vendor.purchasing.manage", "vendor.inventory.manage"]);
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} icon={TrendingUp} actions={act ? <RecalcButton /> : undefined} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile icon={PackageX} label={t("kpi.out")} value={n("OUT")} locale={locale} tone="tone-pink" i={0} href={`${B}/restock`} testId="kpi-out" />
        <Tile icon={AlertOctagon} label={t("kpi.orderNow")} value={n("LATE") + n("ORDER_NOW")} locale={locale} tone="tone-orange" i={1} href={`${B}/restock`} testId="kpi-order-now" hint={n("LATE") ? t("kpi.late", { count: n("LATE") }) : undefined} />
        <Tile icon={CalendarClock} label={t("kpi.soon")} value={n("SOON")} locale={locale} tone="tone-violet" i={2} href={`${B}/restock`} />
        <Tile icon={Gauge} label={t("kpi.accuracy")} value={acc.accuracyPct === null ? undefined : acc.accuracyPct / 100} fmt="percent" locale={locale} tone="tone-teal" i={3} href={`${B}/forecast`} testId="kpi-accuracy"
          hint={acc.biasPct === null ? t("kpi.noAccuracy") : acc.biasPct > 5 ? t("kpi.biasHigh", { pct: acc.biasPct }) : acc.biasPct < -5 ? t("kpi.biasLow", { pct: -acc.biasPct }) : t("kpi.biasOk")} />
        <Tile icon={Hourglass} label={t("kpi.expiry")} value={expiry} fmt="money" locale={locale} tone="tone-pink" i={4} href={`${B}/risk`} testId="kpi-expiry" />
        <Tile icon={Layers} label={t("kpi.overstock")} value={over} fmt="money" locale={locale} tone="tone-blue" i={5} href={`${B}/risk`} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>{t("mostUrgent")}</CardTitle><CardDescription><Link href={`${B}/restock`} className="text-primary hover:underline">{t("toRestock")}</Link></CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="urgent-list">
              {d.open.length === 0 && <li className="py-2 text-muted-foreground">{t("nothingToOrder")}</li>}
              {d.open.slice(0, 7).map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-2">
                  <Badge variant={URGENCY_TONE[s.urgency]} className="shrink-0">{t(`urgency.${s.urgency}`)}</Badge>
                  <Link href={`${B}/forecast/${s.offerId}?w=${s.addressId}`} className="min-w-0 flex-1 truncate text-primary hover:underline">{rowLabel({ product: s.offer.packaging.variant.product.name, packaging: s.offer.packaging.name, sku: s.offer.vendorSku }, locale)}</Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{t("buyQty", { qty: s.qty })}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("accuracyTitle")}</CardTitle><CardDescription>{t("accuracyHint")}</CardDescription></CardHeader>
          <CardContent>
            {d.accuracy.weeks.length ? <AccuracyChart weeks={d.accuracy.weeks} locale={locale} testId="accuracy-chart" labels={{ forecast: t("chart.past"), actual: t("chart.actual"), units: t("units") }} /> : <p className="text-sm text-muted-foreground">{t("kpi.noAccuracy")}</p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t("howTitle")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <p>{t("how1")}</p>
            <p className="flex flex-wrap gap-2">{(["AVERAGE", "HOLT", "CROSTON", "SEASONAL"] as const).map((m) => <Badge key={m} variant="outline">{t(`methods.${m}`)} · {methods[m] ?? 0}</Badge>)}</p>
          </div>
          <div className="space-y-2">
            <p>{t("how2", { sl: d.cp.settings.serviceLevel, review: d.cp.settings.reviewDays })}</p>
            <p className="text-muted-foreground">{t("how3")}</p>
            <p><Link href={`${B}/settings`} className="text-primary hover:underline">{t("toSettings")}</Link> · <Link href={`${B}/events`} className="text-primary hover:underline">{t("toEvents")}</Link> · <Link href={`${B}/lead-times`} className="text-primary hover:underline">{t("toLeadTimes")}</Link></p>
          </div>
        </CardContent>
      </Card>
      <p className="mt-4 text-xs text-muted-foreground">{t("valuesAtCost", { value: formatMoney(d.cp.rows.reduce((a, r) => a + r.onHand * r.avgCost, 0), locale) })}</p>
    </>
  );
}
