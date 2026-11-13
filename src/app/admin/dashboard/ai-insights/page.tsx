import Link from "next/link";
import { AlertTriangle, Bot, PackageX, PiggyBank, Repeat, TrendingUp, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Aurora, LiveDot, rise } from "@/components/motion/shapes";
import { HeroStat, Tile } from "@/components/motion/dashboard-kit";
import { ForecastSpark } from "@/components/ai/forecast-chart";
import { RecDecision, RefreshInsights } from "@/components/ai/actions";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canAi, demandForecast } from "@/server/ai/insights";
import { ensureFresh, listRecommendations, recommendationCounts } from "@/server/ai/feed";
import { assistantStatus } from "@/server/ai/assistant";
import { REC_LABEL, type RecKind } from "@/lib/ai";

export const metadata = { title: "AI Insights" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.ai.view");
  await ensureFresh();
  const seeDemand = canAi(ctx, "STAFF", ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"]);
  const [counts, top, demand, status] = await Promise.all([
    recommendationCounts(ctx), listRecommendations(ctx, "STAFF", { limit: 8 }),
    seeDemand ? demandForecast(ctx, "STAFF", { limit: 6 }) : Promise.resolve([]), assistantStatus("STAFF"),
  ]);
  const c = (k: RecKind) => counts[k] ?? 0;
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  return (
    <div className="space-y-5">
      <Aurora>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="motion-rise">
            <div className="mb-2 flex items-center gap-3 text-white/80"><LiveDot label="Refreshed hourly" /><span className="text-sm">FIRINGI AI · suggests, never acts on its own</span></div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow sm:text-4xl">AI Insights</h1>
            <p className="mt-1 text-white/80">{total ? `${total} suggestions waiting for a person` : "All clear — nothing needs attention"}</p>
          </div>
          <div className="flex gap-2">
            <RefreshInsights />
            {status.enabled && <Link href="/admin/ai/assistant" className="glass inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white"><Bot className="size-4" aria-hidden /> Ask the assistant</Link>}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 @2xl:grid-cols-4" data-testid="ai-hero">
          <HeroStat label="Reorders late" value={c("REORDER_DUE")} locale="en" href="/admin/ai/reorder-predictions" i={0} />
          <HeroStat label="Stock running out" value={c("STOCK_OUT")} locale="en" href="/admin/ai/stock-predictions" i={1} />
          <HeroStat label="Deliveries at risk" value={c("DELIVERY_RISK")} locale="en" href="/admin/ai/delivery-risk" i={2} />
          <HeroStat label="Demand rising" value={c("DEMAND_SURGE")} locale="en" href="/admin/ai/demand-forecasting" i={3} />
        </div>
      </Aurora>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile icon={Repeat} label="Late reorders" value={c("REORDER_DUE")} locale="en" href="/admin/ai/reorder-predictions" tone="tone-blue" i={0} hint="customers past their usual rhythm" />
        <Tile icon={PackageX} label="Stock-outs coming" value={c("STOCK_OUT")} locale="en" href="/admin/ai/stock-predictions" tone="tone-pink" i={1} hint="under 7 days of stock" />
        <Tile icon={Truck} label="Late deliveries" value={c("DELIVERY_RISK")} locale="en" href="/admin/ai/delivery-risk" tone="tone-orange" i={2} hint="high risk open orders" />
        <Tile icon={TrendingUp} label="Rising demand" value={c("DEMAND_SURGE")} locale="en" href="/admin/ai/demand-forecasting" tone="tone-lime" i={3} hint="+30% or more next 4 weeks" />
        <Tile icon={PiggyBank} label="Better suppliers" value={c("CHEAPER_SUPPLIER")} locale="en" href="/admin/ai/supplier-recommendations" tone="tone-teal" i={4} hint="cheaper or more reliable" />
        <Tile icon={AlertTriangle} label="Margin gaps" value={c("MARGIN_GAP")} locale="en" href="/admin/ai/margin-opportunities" tone="tone-violet" i={5} hint="below the margin rules" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className={`lg:col-span-3 ${rise(6).className}`} style={rise(6).style}>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Most important now</CardTitle><Link className="text-sm text-primary underline-offset-4 hover:underline" href="/admin/ai/recommendations">All suggestions →</Link></CardHeader>
          <CardContent className="space-y-3" data-testid="ai-top">
            {top.map((r) => (
              <div key={r.id} className="rounded-xl border p-3">
                <div className="mb-1 flex items-center gap-2"><Badge variant="secondary">{REC_LABEL[r.kind as RecKind] ?? r.kind}</Badge><span className="ml-auto text-xs tabular-nums text-muted-foreground">importance {r.score}</span></div>
                <p className="text-sm">{r.title}</p>
                <div className="mt-2"><RecDecision id={r.id} acceptLabel={r.kind === "REORDER_DUE" ? "Create call task" : r.kind === "STOCK_OUT" ? "Tell the supplier" : "Done"} /></div>
              </div>
            ))}
            {!top.length && <p className="text-sm text-muted-foreground">No open suggestions.</p>}
          </CardContent>
        </Card>
        <Card className={`lg:col-span-2 ${rise(7).className}`} style={rise(7).style}>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Biggest demand, next 4 weeks</CardTitle><Link className="text-sm text-primary underline-offset-4 hover:underline" href="/admin/ai/demand-forecasting">Forecasts →</Link></CardHeader>
          <CardContent className="space-y-3" data-testid="ai-demand">
            {demand.map((d) => (
              <div key={d.offerId}>
                <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium">{d.product}</span><span className="tabular-nums">{d.nextWeeks} units</span></div>
                <ForecastSpark history={d.history} forecast={d.forecast} label={`${d.product} forecast`} height={36} />
              </div>
            ))}
            {!demand.length && <p className="text-sm text-muted-foreground">{seeDemand ? "No orders to learn from yet." : "Your role doesn't include order volumes."}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
