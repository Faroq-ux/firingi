import { LineChart } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { accuracyOf, myPlan } from "@/server/planning/service";
import { rowLabel } from "@/server/planning/engine";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Sparkline } from "@/components/motion/shapes";
import { RecalcButton } from "@/components/planning/vendor";

export const metadata = { title: "Demand forecast" };
const B = "/vendor/inventory/planning";
const sum = (xs: number[]) => xs.reduce((a, v) => a + v, 0);

export default async function ForecastList() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [cp, acc, t, locale] = await Promise.all([myPlan(ctx), accuracyOf(ctx.company.id), getTranslations("planning"), getLocale()]);
  const nf = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  const rows = cp.rows.filter((r) => r.fit.weeksOfHistory > 0 || r.onHand > 0).sort((a, b) => sum(b.forecast.slice(0, 4)) - sum(a.forecast.slice(0, 4)));
  return (
    <>
      <PageHeader title={t("forecastTitle")} description={t("forecastIntro", { weeks: cp.defaults.horizonWeeks })} icon={LineChart} actions={can(ctx, ["vendor.purchasing.manage", "vendor.inventory.manage"]) ? <RecalcButton /> : undefined} />
      <Card>
        <CardContent className="pt-6">
          <DataTable tableId="vendor.planning.forecast" testId="forecast-table" empty={t("noForecast")}
            columns={[
              { key: "product", label: t("col.product") }, { key: "wh", label: t("col.warehouse"), filter: true }, { key: "method", label: t("col.method"), type: "badge", filter: true },
              { key: "last4", label: t("col.last4"), type: "number" }, { key: "next4", label: t("col.next4"), type: "number" }, { key: "trend", label: t("col.trend"), type: "number" },
              { key: "spark", label: t("col.shape") }, { key: "cover", label: t("col.cover"), type: "number" }, { key: "acc", label: t("col.accuracy"), type: "number" },
            ]}
            rows={rows.map((r) => {
              const last4 = sum(r.history.slice(-4)), next4 = sum(r.forecast.slice(0, 4));
              const trend = last4 > 0 ? Math.round(((next4 - last4) / last4) * 100) : null;
              const a = acc.series.get(r.key);
              return {
                id: r.key, href: `${B}/forecast/${r.offerId}?w=${r.addressId}`,
                cells: {
                  product: { t: rowLabel(r, locale), sub: r.events.length ? t("withEvents", { count: r.events.length }) : undefined },
                  wh: r.warehouse,
                  method: r.fit.weeksOfHistory ? { t: t(`methods.${r.fit.method}`), tone: "outline" } : { t: t("methods.NONE"), tone: "secondary" },
                  last4: { t: nf(last4), v: last4 }, next4: { t: nf(next4), v: next4 },
                  trend: trend === null ? { t: "—", v: 0 } : { t: `${trend > 0 ? "+" : ""}${trend} %`, v: trend, tone: trend >= 15 ? "success" : trend <= -15 ? "warning" : undefined },
                  spark: { t: "", node: <Sparkline values={[...r.history.slice(-12), ...r.forecast.slice(0, 4)]} label={t("col.shape")} height={26} className="w-28" /> },
                  cover: r.plan.coverDays === null ? { t: r.plan.dailyDemand > 0 ? "365+" : "—", v: 9999 } : { t: t("daysShort", { days: r.plan.coverDays }), v: r.plan.coverDays, tone: r.plan.coverDays < r.leadTimeDays ? "destructive" : undefined },
                  acc: a?.accuracyPct == null ? { t: "—", v: -1 } : { t: `${a.accuracyPct} %`, v: a.accuracyPct, tone: a.accuracyPct >= 80 ? "success" : a.accuracyPct < 50 ? "warning" : undefined },
                },
              };
            })} />
        </CardContent>
      </Card>
    </>
  );
}
