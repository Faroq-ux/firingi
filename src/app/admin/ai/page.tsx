import Link from "next/link";
import { AlertTriangle, Bot, Fuel, Leaf, Route as RouteIcon, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { ForecastSpark } from "@/components/ai/forecast-chart";
import { RecDecision, RefreshInsights } from "@/components/ai/actions";
import { AiCentreSettingsForm } from "@/components/ai/centre";
import { centreDashboard } from "@/server/ai/centre/dashboard";
import { can } from "@/server/rbac/guard";
import { AREA_LABEL, REC_AREAS, REPORT_LABEL, type ReportKind } from "@/lib/ai-centre";
import { AREA_TONE, aiPage, eur, num, pct } from "./_kit";

export const metadata = { title: "AI Dashboard" };
export const dynamic = "force-dynamic";

export default async function AiDashboard() {
  const { ctx } = await aiPage();
  const d = await centreDashboard(ctx);
  const fuelLine = [d.route.litres ? `${num(d.route.litres)} L fuel` : null, d.route.kwh ? `${num(d.route.kwh)} kWh` : null].filter(Boolean).join(" · ") || "fuel / energy";
  return (
    <>
      <PageHeader title="AI Dashboard" icon={Sparkles}
        description="Everything FIRINGI's AI found, in one place: what needs attention first, savings waiting on delivery routes, the forecast and what the AI did. AI suggests; people decide."
        actions={<div className="flex flex-wrap items-center gap-2"><Badge variant={d.assistant.enabled ? "success" : "secondary"} data-testid="aid-ai-status">{d.assistant.enabled ? "Claude connected" : "Claude not connected"}</Badge><RefreshInsights /></div>} />
      <p className="mb-4 text-xs text-muted-foreground" data-testid="aid-refreshed">Last refreshed {d.lastRefresh ? d.lastRefresh.toISOString().slice(0, 16).replace("T", " ") : "never"} (every hour).</p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="aid-kpis">
        <Tile icon={Sparkles} label="Open suggestions" value={d.open} locale="en" href="/admin/ai/recommendations" tone="tone-blue" i={0} hint={`${d.high} important (score 75+)`} testId="aid-open" />
        <Tile icon={RouteIcon} label="Route savings waiting" value={d.route.km} locale="en" href="/admin/ai/recommendations?area=ROUTES" tone="tone-lime" i={1} hint={`km · ${eur(d.route.cost, 2)} · ${fuelLine}`} testId="aid-route" />
        <Tile icon={Leaf} label="CO₂ that can be avoided" value={d.route.co2} locale="en" href="/admin/ai/recommendations?area=ROUTES" tone="tone-teal" i={2} hint="kg, on planned routes" />
        <Tile icon={TrendingUp} label="Sales, next 4 weeks" value={d.forecast?.next4 ?? 0} fmt="money" locale="en" href="/admin/ai/forecasting?tab=SALES" tone="tone-violet" i={3} hint={d.forecast ? `${pct(d.forecast.trend)} vs the last 4 weeks` : "no access to sales"} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="aid-areas">
        {REC_AREAS.filter((a) => d.settings.areas[a]).map((a, i) => (
          <Link key={a} href={`/admin/ai/recommendations?area=${a}`} className={`stat-card rounded-2xl border bg-card p-3 hover:-translate-y-0.5 ${AREA_TONE[a]}`} style={{ ["--i" as string]: i } as React.CSSProperties} data-testid="aid-area" data-area={a}>
            <p className="text-xs text-muted-foreground">{AREA_LABEL[a]}</p><p className="text-xl font-semibold tabular-nums">{d.byArea[a]}</p>
          </Link>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Do these first</CardTitle><Link className="text-sm text-primary underline-offset-4 hover:underline" href="/admin/ai/recommendations">All suggestions →</Link></CardHeader>
          <CardContent>
            {!d.top.length ? <p className="text-sm text-muted-foreground">All clear — nothing needs attention.</p> : (
              <ul className="divide-y" data-testid="aid-top">
                {d.top.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="aid-top-row">
                    <Badge variant="secondary">{AREA_LABEL[r.area]}</Badge>
                    <span className="min-w-0 flex-1 basis-64 break-words">{r.title}</span>
                    <span className="w-10 text-right tabular-nums text-muted-foreground">{r.score}</span>
                    <RecDecision id={r.id} acceptLabel="Do it" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {!d.alerts.length && d.fraudHeld === null && <p className="text-sm text-muted-foreground">No alerts.</p>}
            {d.fraudHeld !== null && d.fraudHeld > 0 && <Link href="/admin/ai/reports?tab=FRAUD" className="flex items-start gap-2 rounded-xl border border-destructive/30 p-2 text-sm" data-testid="aid-fraud"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> {d.fraudHeld} order{d.fraudHeld === 1 ? "" : "s"} held for a fraud check</Link>}
            {d.alerts.map((a) => (
              <Link key={a.id} href={`/admin/ai/recommendations?area=${a.area}`} className={`flex items-start gap-2 rounded-xl border p-2 text-sm ${a.tone === "destructive" ? "border-destructive/30" : "border-amber-500/30"}`} data-testid="aid-alert">
                <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${a.tone === "destructive" ? "text-destructive" : "text-amber-600"}`} /> <span className="min-w-0 break-words">{a.text}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Sales forecast</CardTitle><CardDescription>16 weeks of net sales and the next 8.</CardDescription></CardHeader>
          <CardContent>{d.forecast ? <><ForecastSpark history={d.forecast.history} forecast={d.forecast.forecast} height={90} label={`Sales: ${eur(d.forecast.last4)} in the last 4 weeks, about ${eur(d.forecast.next4)} in the next 4`} /><p className="mt-2 text-sm">Next 4 weeks: <b>{eur(d.forecast.next4)}</b> ({pct(d.forecast.trend)})</p><Link href="/admin/ai/forecasting" className="text-sm text-primary underline-offset-4 hover:underline">All forecasts →</Link></> : <p className="text-sm text-muted-foreground">Your role doesn&apos;t include sales data.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>AI activity</CardTitle><CardDescription>Last 30 days: {d.usage30.events} events · {(d.usage30.tokensIn + d.usage30.tokensOut).toLocaleString("en")} tokens · suggestions accepted {d.decided30.rate === null ? "—" : `${d.decided30.rate}%`}</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm" data-testid="aid-activity">{d.activity.map((a) => <li key={a.id} className="flex gap-2"><span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground">{a.at.toISOString().slice(5, 16).replace("T", " ")}</span><span className="min-w-0 break-words">{a.summary}</span></li>)}</ul>
            <Link href="/admin/ai/activity-log" className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">Activity log →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Reports &amp; assistant</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-1">{d.reports.length ? d.reports.map((r) => <li key={r.id}><Link href={`/admin/ai/reports?tab=${r.kind}&run=${r.id}`} className="underline-offset-4 hover:underline">{REPORT_LABEL[r.kind as ReportKind] ?? r.kind}</Link> <span className="text-xs text-muted-foreground">· {r.createdAt.toISOString().slice(0, 10)}{r.byClaude ? " · by Claude" : ""}</span></li>) : <li className="text-muted-foreground">No reports yet.</li>}</ul>
            <Link href="/admin/ai/reports" className="text-primary underline-offset-4 hover:underline">AI Reports →</Link>
            <p className="flex items-center gap-2 border-t pt-3"><Bot className="size-4" /> {d.assistant.enabled ? <Link href="/admin/ai/assistant" className="text-primary underline-offset-4 hover:underline">Ask the AI Assistant →</Link> : "The assistant switches on once Claude is connected."}</p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Fuel className="size-4" /> Route savings use the fuel prices below.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>AI Centre settings</CardTitle><CardDescription>Switch each area, forecast and report on or off; fuel and energy rates for route savings; thresholds; the weekly email.</CardDescription></CardHeader>
        <CardContent><AiCentreSettingsForm settings={d.settings} canSave={can(ctx, "admin.settings.manage")} /></CardContent>
      </Card>
    </>
  );
}
