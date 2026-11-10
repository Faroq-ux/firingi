import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { deliveryRisk, demandForecast, reorderPredictions, stockPredictions } from "@/server/ai/insights";
import { listRecommendations } from "@/server/ai/feed";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ForecastSpark } from "@/components/ai/forecast-chart";
import { RecDecision } from "@/components/ai/actions";
import { StockBadge } from "@/components/ai/portal-cards";
import type { RiskReason } from "@/lib/ai";

export const metadata = { title: "Demand & Stock" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reports.view");
  const [t, locale] = await Promise.all([getTranslations("ai"), getLocale()]);
  const [demand, stock, risks, due, recs] = await Promise.all([
    demandForecast(ctx, "VENDOR", { locale, limit: 50 }), stockPredictions(ctx, "VENDOR", { locale, onlyAtRisk: true }),
    deliveryRisk(ctx, "VENDOR"), reorderPredictions(ctx, "VENDOR", { locale, onlyDue: true }), listRecommendations(ctx, "VENDOR", { limit: 10 }),
  ]);
  const pct = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 0 }).format(n));
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  // Suggestions are computed once (in English); show product names in the reader's language.
  const names = new Map([...demand, ...stock].map((x) => [x.offerId, `${x.product} (${x.pack})`]));
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));
  const recText = (r: (typeof recs)[number]) => {
    const d = r.detail as Record<string, unknown>;
    const product = names.get(String(r.subjectId)) ?? `${d.product ?? ""}${d.pack ? ` (${d.pack})` : ""}`;
    if (r.kind === "STOCK_OUT") return d.status === "OUT" ? t("rec.OUT", { product }) : t("rec.STOCK_OUT", { product, days: Number(d.days ?? 0) });
    if (r.kind === "LOW_COVER") return t("rec.LOW_COVER", { product, days: Number(d.days ?? 0) });
    if (r.kind === "DEMAND_SURGE") return t("rec.DEMAND_SURGE", { product, pct: pct(Number(d.trend ?? 0)) });
    if (r.kind === "DELIVERY_RISK") return t("rec.DELIVERY_RISK", { number: String(d.number), customer: String(d.buyer) });
    return r.title;
  };
  const reason = (x: RiskReason) => t(`reason.${x.code}`, { n: x.n ?? 0 });
  return (
    <>
      <PageHeader title={t("demand.title")} description={t("demand.description")} />
      {recs.length > 0 && (
        <Card className="mb-4 tile gloss tone-violet motion-rise"><CardHeader><CardTitle>{t("demand.suggestions")}</CardTitle></CardHeader>
          <CardContent className="space-y-2" data-testid="vendor-recs">
            {recs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/70 p-2 text-sm">
                <span className="flex-1">{recText(r)}</span>
                {r.kind === "DELIVERY_RISK" && <Link className="text-xs text-primary underline-offset-4 hover:underline" href={`/vendor/orders/${r.subjectId}`}>→</Link>}
                <RecDecision id={r.id} acceptLabel={t("demand.done")} dismissLabel={t("demand.dismiss")} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{t("demand.stockTitle")}</CardTitle></CardHeader><CardContent>
          <Table data-testid="vendor-stock">
            <THead><TR><TH>{t("demand.product")}</TH><TH className="text-right">{t("demand.available")}</TH><TH className="text-right">{t("demand.perDay")}</TH><TH className="text-right">{t("demand.daysLeft")}</TH><TH>{t("demand.statusCol")}</TH></TR></THead>
            <TBody>
              {stock.map((s) => <TR key={s.offerId}><TD><div className="font-medium">{s.product}</div><div className="text-xs text-muted-foreground">{s.pack}</div></TD><TD className="text-right tabular-nums">{s.available}</TD><TD className="text-right tabular-nums">{s.dailyUnits}</TD><TD className="text-right font-semibold tabular-nums">{s.days ?? "—"}</TD><TD><StockBadge s={s} /></TD></TR>)}
              {!stock.length && <EmptyRow colSpan={5}>{t("demand.noStockRisk")}</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("demand.riskTitle")}</CardTitle></CardHeader><CardContent>
          <Table data-testid="vendor-risk">
            <THead><TR><TH>{t("demand.order")}</TH><TH>{t("demand.customer")}</TH><TH>{t("demand.why")}</TH></TR></THead>
            <TBody>
              {risks.map((r) => <TR key={r.orderId}><TD><Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/vendor/orders/${r.orderId}`}>{r.number}</Link> <Badge variant={r.level === "HIGH" ? "destructive" : r.level === "MEDIUM" ? "warning" : "secondary"}>{r.score}</Badge></TD><TD>{r.buyer}</TD><TD className="text-xs">{r.reasons.map(reason).join(" · ")}</TD></TR>)}
              {!risks.length && <EmptyRow colSpan={3}>{t("demand.noRisk")}</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
      <Card className="mb-4"><CardHeader><CardTitle>{t("demand.forecastTitle")}</CardTitle></CardHeader><CardContent>
        <Table data-testid="vendor-demand">
          <THead><TR><TH>{t("demand.product")}</TH><TH className="w-48">{t("demand.chart")}</TH><TH className="text-right">{t("demand.last4")}</TH><TH className="text-right">{t("demand.next4")}</TH><TH className="text-right">{t("demand.trend")}</TH></TR></THead>
          <TBody>
            {demand.map((r) => <TR key={r.offerId}><TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD><TD><ForecastSpark history={r.history} forecast={r.forecast} label={`${r.product}: ${r.nextWeeks}`} /></TD><TD className="text-right tabular-nums">{r.lastWeeks}</TD><TD className="text-right font-semibold tabular-nums">{r.nextWeeks}</TD><TD className={`text-right tabular-nums ${(r.trend ?? 0) > 0.05 ? "text-success" : (r.trend ?? 0) < -0.05 ? "text-destructive" : ""}`}>{pct(r.trend)}</TD></TR>)}
            {!demand.length && <EmptyRow colSpan={5}>{t("demand.noForecast")}</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{t("demand.dueTitle")}</CardTitle></CardHeader><CardContent>
        <Table data-testid="vendor-due">
          <THead><TR><TH>{t("demand.customer")}</TH><TH>{t("demand.expected")}</TH><TH className="text-right">{t("demand.usualBasket")}</TH></TR></THead>
          <TBody>
            {due.map((r) => <TR key={r.buyerId}><TD className="font-medium">{r.buyer}</TD><TD className="tabular-nums">{day(r.expected)} {r.overdueDays > 0 && <Badge variant="destructive">{t("buyAgain.lateBy", { days: r.overdueDays })}</Badge>}</TD><TD className="text-right tabular-nums">{money(r.usualNet)}</TD></TR>)}
            {!due.length && <EmptyRow colSpan={3}>{t("demand.noDue")}</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
