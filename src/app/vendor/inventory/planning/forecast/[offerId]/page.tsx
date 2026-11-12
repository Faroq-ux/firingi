import Link from "next/link";
import { notFound } from "next/navigation";
import { LineChart } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { forecastDetail } from "@/server/planning/service";
import { rowLabel } from "@/server/planning/engine";
import { isoDay } from "@/server/planning/model";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ForecastChart, type ForecastPoint } from "@/components/planning/forecast-chart";
import { PlanningItemForm, type SourceOpt } from "@/components/planning/vendor";
import { URGENCY_TONE } from "@/lib/planning";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Forecast" };
const B = "/vendor/inventory/planning";

export default async function ForecastDetail({ params, searchParams }: { params: Promise<{ offerId: string }>; searchParams: Promise<{ w?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [{ offerId }, { w }] = await Promise.all([params, searchParams]);
  const d = await forecastDetail(ctx, offerId, w).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [t, locale] = await Promise.all([getTranslations("planning"), getLocale()]);
  const { row: r, cp } = d;
  const nf = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
  const evName = (t0: number) => r.events.filter((e) => e.startsOn.getTime() < t0 + 7 * 86_400_000 && e.endsOn.getTime() >= t0).map((e) => `${e.name} (${e.upliftPct > 0 ? "+" : ""}${e.upliftPct} %)`).join(", ") || null;
  const pastBy = new Map(d.past.map((p) => [isoDay(p.week), p.qty]));
  const hist = r.history.slice(-16), mondays = r.mondays.slice(-16);
  const points: ForecastPoint[] = [
    ...hist.map((v, i) => ({ t: mondays[i].getTime(), actual: v, past: pastBy.get(isoDay(mondays[i])) ?? null, event: evName(mondays[i].getTime()) })),
    ...r.forecast.map((v, i) => ({ t: r.futureMondays[i].getTime(), forecast: v, low: r.low[i], high: r.high[i], event: evName(r.futureMondays[i].getTime()) })),
  ];
  const others = cp.rows.filter((x) => x.addressId !== r.addressId);
  const sources: SourceOpt[] = cp.sources.filter((s) => s.kind === "OUTSIDE" && s.active).map((s) => ({ key: `S:${s.id}`, label: s.name, kind: "OUTSIDE", id: s.id }));
  if (r.source?.kind === "FIRINGI") sources.unshift({ key: `F:${r.source.id}`, label: `${r.source.name} (FIRINGI)`, kind: "FIRINGI", id: r.source.id, sourceOfferId: r.source.sourceOfferId });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 9 + i))));
  const maxW = Math.max(0.0001, ...d.weekday);
  const p = r.plan;
  const leadBasis = t(`leadBasis.${r.leadBasis}`);
  const scores = Object.entries(r.fit.scores).sort((a, b) => a[1] - b[1]);
  return (
    <>
      <PageHeader title={rowLabel(r, locale)} description={t("detailIntro", { warehouse: r.warehouse })} icon={LineChart}
        actions={<Link href={`${B}/forecast`} className="text-sm text-primary hover:underline">{t("backToForecast")}</Link>} />
      {others.length > 0 && (
        <p className="mb-4 flex flex-wrap gap-2 text-sm">{t("otherWarehouses")} {others.map((o) => <Link key={o.addressId} href={`${B}/forecast/${offerId}?w=${o.addressId}`} className="text-primary hover:underline">{o.warehouse}</Link>)}</p>
      )}
      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">{t("chartTitle")} <Badge variant="outline" data-testid="method">{t(`methods.${r.fit.weeksOfHistory ? r.fit.method : "NONE"}`)}</Badge></CardTitle>
            <CardDescription>{t("chartHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ForecastChart points={points} locale={locale} testId="forecast-chart" ariaLabel={t("chartTitle")}
              labels={{ actual: t("chart.actual"), forecast: t("chart.forecast"), range: t("chart.range"), past: t("chart.past"), now: t("chart.now"), units: t("units"), event: t("chart.event") }} />
          </CardContent>
        </Card>
        <Card data-testid="plan-card">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">{t("planTitle")} {p.urgency ? <Badge variant={URGENCY_TONE[p.urgency]}>{t(`urgency.${p.urgency}`)}</Badge> : <Badge variant="success">{t("urgency.OK")}</Badge>}</CardTitle>
            <CardDescription>{p.urgency ? t("suggestBuy", { qty: p.qty }) : r.excluded ? t("excludedNote") : t("noNeed")}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t("plan.usable")}</dt><dd className="text-right tabular-nums" data-testid="plan-usable">{r.usable}</dd>
              <dt className="text-muted-foreground">{t("plan.incoming")}</dt><dd className="text-right tabular-nums">{r.incoming}{r.draft ? ` (${t("plan.drafts", { qty: r.draft })})` : ""}</dd>
              <dt className="text-muted-foreground">{t("plan.daily")}</dt><dd className="text-right tabular-nums">{nf(p.dailyDemand)}</dd>
              <dt className="text-muted-foreground">{t("plan.lead")}</dt><dd className="text-right tabular-nums" data-testid="plan-lead">{t("daysShort", { days: r.leadTimeDays })} · {leadBasis}</dd>
              <dt className="text-muted-foreground">{t("plan.service")}</dt><dd className="text-right tabular-nums">{r.serviceLevel} %</dd>
              <dt className="text-muted-foreground">{t("plan.safety")}</dt><dd className="text-right tabular-nums">{p.safetyStock}</dd>
              <dt className="text-muted-foreground">{t("plan.rop")}</dt><dd className="text-right tabular-nums">{p.reorderPoint}{r.manualReorderPoint !== null && r.manualReorderPoint === p.reorderPoint ? ` (${t("plan.manual")})` : ""}</dd>
              <dt className="text-muted-foreground">{t("plan.upto")}</dt><dd className="text-right tabular-nums">{p.orderUpTo}</dd>
              <dt className="text-muted-foreground">{t("plan.cover")}</dt><dd className="text-right tabular-nums">{p.coverDays === null ? (p.dailyDemand > 0 ? "365+" : "—") : t("daysShort", { days: p.coverDays })}</dd>
              <dt className="text-muted-foreground">{t("plan.source")}</dt><dd className="truncate text-right">{r.source?.name ?? "—"}{r.unitCost !== null ? ` · ${formatMoney(r.unitCost, locale)}` : ""}</dd>
              <dt className="text-muted-foreground">{t("plan.rules")}</dt><dd className="text-right tabular-nums">{t("plan.rulesValue", { min: r.minOrderQty, mult: r.packMultiple })}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{t("whyTitle")}</CardTitle><CardDescription>{t(`methodWhy.${r.fit.weeksOfHistory ? r.fit.method : "NONE"}`)}</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{t("historyWeeks", { weeks: r.fit.weeksOfHistory })}{r.fit.intermittent ? ` · ${t("intermittent")}` : ""}</p>
            {scores.length > 1 && (
              <table className="w-full text-sm" data-testid="backtest"><thead><tr className="text-left text-xs text-muted-foreground"><th className="font-normal">{t("col.method")}</th><th className="text-right font-normal">{t("mae")}</th></tr></thead>
                <tbody>{scores.map(([m, v]) => <tr key={m} className={m === r.fit.method ? "font-semibold" : ""}><td>{t(`methods.${m}`)}{m === r.fit.method ? " ✓" : ""}</td><td className="text-right tabular-nums">{nf(v)}</td></tr>)}</tbody></table>
            )}
            <p className="text-muted-foreground">{d.accuracy.accuracyPct === null ? t("kpi.noAccuracy") : t("productAccuracy", { pct: d.accuracy.accuracyPct, weeks: d.accuracy.weeks })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("weekdayTitle")}</CardTitle><CardDescription>{t("weekdayHint")}</CardDescription></CardHeader>
          <CardContent>
            <div className="flex h-32 items-end gap-2" role="img" aria-label={t("weekdayTitle")} data-testid="weekday">
              {d.weekday.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(v * 100)}%</span>
                  <div className="w-full rounded-t" style={{ height: `${Math.max(2, (v / maxW) * 80)}px`, background: "var(--series-1)" }} />
                  <span className="text-xs text-muted-foreground">{weekdays[i]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("eventsTitle")}</CardTitle><CardDescription><Link href={`${B}/events`} className="text-primary hover:underline">{t("toEvents")}</Link></CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm" data-testid="product-events">
              {r.events.length === 0 && <li className="text-muted-foreground">{t("noEvents")}</li>}
              {r.events.map((e) => <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{e.name}{e.companyId ? "" : " · FIRINGI"}</span><span className="shrink-0 tabular-nums text-muted-foreground">{e.upliftPct > 0 ? "+" : ""}{e.upliftPct} % · {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(e.startsOn)}–{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(e.endsOn)}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      </div>
      {can(ctx, "vendor.inventory.manage") && (
        <Card>
          <CardHeader><CardTitle>{t("choicesTitle")}</CardTitle><CardDescription>{t("choicesHint")}</CardDescription></CardHeader>
          <CardContent>
            <PlanningItemForm offerId={r.offerId} addressId={r.addressId} sources={sources} defaults={{ serviceLevel: cp.settings.serviceLevel, leadTimeDays: r.leadTimeDays }}
              initial={{
                serviceLevel: d.item?.serviceLevel?.toString() ?? "", leadTimeDays: d.item?.leadTimeDays?.toString() ?? "", minOrderQty: String(d.item?.minOrderQty ?? 1), packMultiple: String(d.item?.packMultiple ?? 1),
                source: d.item?.supplierId ? `S:${d.item.supplierId}` : d.item?.sellerCompanyId ? `F:${d.item.sellerCompanyId}` : "", unitCost: d.item?.unitCost?.toString() ?? "", excluded: d.item?.excluded ?? false, note: d.item?.note ?? "",
              }} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
