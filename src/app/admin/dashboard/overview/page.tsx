import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Building2, Globe, Store, Truck, Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminLive, adminOverview } from "@/server/data/dashboard";
import { adminCentre } from "@/server/data/admin-centre";
import { ActionsPanel, HealthPanel, MoneyPanel, PipelinePanel, SalesPanel, SplitPanel, TopPanel } from "@/components/dashboard/admin-centre";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import { Aurora, LiveDot, ProgressRing, Sparkline, rise } from "@/components/motion/shapes";
import { HeroStat, OrderTicker, Tile } from "@/components/motion/dashboard-kit";
import { RouteMap } from "@/components/motion/route-map";
import { CountUp } from "@/components/motion/count-up";
import { AutoRefresh } from "@/components/routes/auto-refresh";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { getPreference } from "@/server/services/workspace";

export const metadata = { title: "Executive Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.dashboard.view");
  const [o, live, t, tc, ts, tl, locale, layout, c] = await Promise.all([adminOverview(ctx), adminLive(ctx), getTranslations("dashboard"), getTranslations("companyType"), getTranslations("orders.statuses"), getTranslations("live"), getLocale(), getPreference<Record<string, never>>(ctx, "dashboard.admin"), adminCentre(ctx)]);
  const ta = await getTranslations("adminDash");
  const net14 = live.series.reduce((a, d) => a + d.net, 0);
  const d = live.deliveries;
  return (
    <div className="space-y-5">
      <AutoRefresh seconds={60} />
      <Aurora>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="motion-rise">
            <div className="mb-2 flex items-center gap-3 text-white/80"><LiveDot label={t("live")} /><span className="text-sm">{new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span></div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow sm:text-4xl">{t("welcome", { name: ctx.user.name })}</h1>
            <p className="mt-1 text-white/80">FIRINGI · WHOLESALE MADE SIMPLE</p>
          </div>
          <div className="glass motion-rise w-full rounded-xl p-3 sm:w-72" style={{ ["--i" as string]: 1 }}>
            <div className="flex items-baseline justify-between text-white"><span className="text-xs font-semibold uppercase tracking-wider text-white/75">{t("salesTrend")}</span><span className="font-bold"><CountUp value={net14} fmt="money" locale={locale} /></span></div>
            <Sparkline values={live.series.map((x) => x.net)} label={t("salesTrend")} color="white" height={64} className="mt-2" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          <HeroStat label={t("ordersToday")} value={o.orders.today} locale={locale} href="/admin/dashboard/today" i={0} />
          <HeroStat label={t("monthSales")} value={Number(o.orders.monthNet)} fmt="money" locale={locale} sub={`${o.orders.monthCount} · ${t("margin")} ${formatMoney(o.orders.monthMargin, locale)}`} i={1} />
          <HeroStat label={t("awaitingConfirmation")} value={o.orders.awaiting} locale={locale} href="/admin/orders/pending-confirmation" i={2} />
          <HeroStat label={t("openExceptions")} value={o.orders.exceptions} locale={locale} href="/admin/dashboard/alerts" i={3} />
        </div>
      </Aurora>

      <DashboardGrid prefKey="dashboard.admin" saved={layout} cards={[
        // Phase 59: more information — sales vs last month, money, what needs action, pipeline, best sellers, split, health
        { id: "sales", title: ta("monthSoFar"), size: 2, node: <SalesPanel d={c} locale={locale} /> },
        { id: "actions", title: ta("needsAction"), node: <ActionsPanel d={c} /> },
        { id: "pipeline", title: ta("inProgress"), size: 3, node: <PipelinePanel d={c} /> },
        ...(c.money ? [{ id: "money", title: ta("money"), node: <MoneyPanel d={c} locale={locale} /> }] : []),
        { id: "top", title: ta("best"), size: 2 as const, node: <TopPanel d={c} locale={locale} /> },
        { id: "split", title: ta("whereFrom"), size: 2 as const, node: <SplitPanel d={c} locale={locale} /> },
        ...(c.health ? [{ id: "health", title: ta("health"), node: <HealthPanel d={c} /> }] : []),
        { id: "latest", title: t("latestOrders"), size: 3, node: live.latest.length > 0 ? (
          <section {...rise(2)}>
            <h2 className="mb-2 text-sm font-semibold text-[color:color-mix(in_oklch,var(--vivid-violet)_75%,var(--foreground))]">{t("latestOrders")}</h2>
            <OrderTicker orders={live.latest} locale={locale} base="/admin/orders" label={t("latestOrders")} statusLabel={(s) => ts(s)} />
          </section>
        ) : <Card className="p-5 text-sm text-muted-foreground">{t("noOrders")}</Card> },
        { id: "deliveries", title: t("deliveriesToday"), node: (
          <Card className="tile gloss tone-teal motion-rise h-full" style={{ ["--i" as string]: 3 }}>
            <CardHeader><CardTitle>{t("deliveriesToday")}</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <ProgressRing value={d.total ? d.done / d.total : 0} size={150} stroke={14} label={t("deliveredOf", { done: d.done, total: d.total })}>
                <div><div className="text-3xl font-extrabold text-gradient"><CountUp value={d.done} fmt="int" locale={locale} /></div><div className="text-xs text-muted-foreground">/ {d.total}</div></div>
              </ProgressRing>
              <p className="text-sm">{t("deliveredOf", { done: d.done, total: d.total })}{d.failed ? <span className="ml-2 font-semibold text-destructive">⚠ {d.failed}</span> : null}</p>
              <Link href="/admin/dashboard/live-operations" className="text-sm font-medium text-primary hover:underline">{t("seeAll")} →</Link>
            </CardContent>
          </Card>
        ) },
        { id: "routes", title: t("routesOnRoad"), size: 2, node: (
          <Card className="motion-rise h-full" style={{ ["--i" as string]: 4 }}>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>{t("routesOnRoad")}</CardTitle><LiveDot label={t("live")} /></CardHeader>
            <CardContent>
              {live.routes.length ? <RouteMap routes={live.routes.map((r) => ({ ...r, href: `/admin/delivery/routes/${r.id}` }))} label={t("routesOnRoad")} height={260} legend={{ depot: t("mapDepot"), done: t("mapDone"), todo: t("mapTodo") }} /> : <p className="py-10 text-center text-sm text-muted-foreground">{t("noRoutes")}</p>}
            </CardContent>
          </Card>
        ) },
        { id: "live", title: tl("title"), node: (
          <Card className="motion-rise h-full glow-border" style={{ ["--i" as string]: 5 }}>
            <CardHeader><CardTitle>{tl("title")}</CardTitle></CardHeader>
            <CardContent><LiveFeed portal="admin" max={8} /></CardContent>
          </Card>
        ) },
        { id: "network", title: t("network"), size: 2, node: (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[color:color-mix(in_oklch,var(--vivid-violet)_75%,var(--foreground))]">{t("network")}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Tile icon={Truck} tone="tone-blue" label={t("distributors")} value={o.distributors.total} hint={t("activeOf", o.distributors)} locale={locale} href="/admin/vendors/distributors/all" i={5} />
              <Tile icon={Store} tone="tone-violet" label={t("wholesalers")} value={o.wholesalers.total} hint={t("activeOf", o.wholesalers)} locale={locale} href="/admin/vendors/wholesalers/all" i={6} />
              <Tile icon={Building2} tone="tone-pink" label={t("customers")} value={o.customers.total} hint={t("activeOf", o.customers)} locale={locale} href="/admin/customers/all" i={7} />
              <Tile icon={Users} tone="tone-orange" label={t("users")} value={o.activeUsers} locale={locale} i={8} />
              <Tile icon={Globe} tone="tone-teal" label={t("markets")} value={o.customerMarkets} locale={locale} i={9} />
              <Tile icon={Globe} tone="tone-lime" label={t("sourcing")} value={o.sourcingCountries} locale={locale} i={10} />
            </div>
          </section>
        ) },
        { id: "recent", title: t("recent"), size: 3, node: (
          <Card {...rise(11)}>
            <CardHeader>
              <CardTitle>{t("recent")}</CardTitle>
              <CardDescription><Link className="text-primary hover:underline" href="/admin/vendors/distributors/applications">→ {t("applications")}</Link></CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <THead><TR><TH>{t("colCompany")}</TH><TH>{t("colType")}</TH><TH>{t("colCountry")}</TH><TH>{t("colStatus")}</TH><TH>{t("colRegistered")}</TH></TR></THead>
                <TBody>
                  {o.recent.map((c) => (
                    <TR key={c.id}>
                      <TD className="font-medium">{c.legalName}</TD>
                      <TD>{tc(c.type)}</TD>
                      <TD>{c.country.flag} {c.country.code}</TD>
                      <TD><AccountStatusBadge status={c.status} /></TD>
                      <TD className="text-muted-foreground">{formatDate(c.createdAt, locale)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        ) },
      ]} />
    </div>
  );
}
