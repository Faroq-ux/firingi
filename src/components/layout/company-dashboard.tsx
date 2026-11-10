import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Star, ClipboardCheck, FileText, PackageCheck, ShoppingCart, Truck, Users, Wallet } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { buyerLive, companyOverview, vendorLive } from "@/server/data/dashboard";
import { supplierScorecards } from "@/server/services/performance";
import { pickLocalized } from "@/i18n/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Aurora, LiveDot, ProgressRing, Sparkline } from "@/components/motion/shapes";
import { HeroStat, OrderTicker, Tile, TopBars } from "@/components/motion/dashboard-kit";
import { RouteMap } from "@/components/motion/route-map";
import { CountUp } from "@/components/motion/count-up";
import { AutoRefresh } from "@/components/routes/auto-refresh";

const pct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
function Trend({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  const p = pct(cur, prev);
  if (p === null) return null;
  return <span className={`font-semibold ${p >= 0 ? "text-white" : "text-white/80"}`}>{p >= 0 ? "▲" : "▼"} {Math.abs(Math.round(p * 100))}% <span className="font-normal text-white/70">{label}</span></span>;
}

/** Live, animated dashboard for the supplier and customer portals (only the company's own data). */
export async function CompanyDashboard({ ctx, portal }: { ctx: Ctx; portal: "vendor" | "buy" }) {
  const [o, t, tc, ts, locale] = await Promise.all([companyOverview(ctx), getTranslations("dashboard"), getTranslations("companyType"), getTranslations("orders.statuses"), getLocale()]);
  const name = o.company.tradeName ?? o.company.legalName;
  const head = (stats: React.ReactNode, spark: { values: number[]; total: number; label: string }) => (
    <Aurora>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="motion-rise">
          <div className="mb-2 flex items-center gap-3 text-white/80"><LiveDot label={t("live")} /><span className="text-sm">{new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span></div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow sm:text-4xl">{t("welcome", { name: ctx.user.name })}</h1>
          <p className="mt-1 text-white/80">{o.company.country.flag} {name} · {tc(ctx.company.type)}</p>
        </div>
        <div className="glass motion-rise w-full rounded-xl p-3 sm:w-72" style={{ ["--i" as string]: 1 }}>
          <div className="flex items-baseline justify-between text-white"><span className="text-xs font-semibold uppercase tracking-wider text-white/75">{spark.label}</span><span className="font-bold"><CountUp value={spark.total} fmt="money" locale={locale} /></span></div>
          <Sparkline values={spark.values} label={spark.label} color="white" height={64} className="mt-2" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{stats}</div>
    </Aurora>
  );

  if (portal === "vendor") {
    const [v, card] = await Promise.all([vendorLive(ctx), supplierScorecards(ctx, "ALL", { from: new Date(Date.now() - 90 * 86400_000), to: new Date() }, ctx.company.id).then((c) => c[0] ?? null)]);
    const d = v.deliveries;
    return (
      <div className="space-y-5">
        <AutoRefresh seconds={60} />
        {head(<>
          <HeroStat label={t("newOrders")} value={v.toConfirm} locale={locale} href="/vendor/orders/incoming" i={0} />
          <HeroStat label={t("ordersToday")} value={v.ordersToday} locale={locale} i={1} />
          <HeroStat label={t("payout30")} value={v.payout30} fmt="money" locale={locale} sub={<Trend cur={v.payout30} prev={v.payoutPrev} label={t("vsPrev")} />} i={2} />
          <HeroStat label={t("toDeliver")} value={d.open} locale={locale} href="/vendor/fleet/deliveries" i={3} />
        </>, { values: v.series.map((x) => x.net), total: v.series.reduce((a, x) => a + x.net, 0), label: t("salesTrend") })}
        {v.latest.length > 0 && (
          <section className="motion-rise" style={{ ["--i" as string]: 2 }}>
            <h2 className="mb-2 text-sm font-semibold text-[color:color-mix(in_oklch,var(--vivid-violet)_75%,var(--foreground))]">{t("latestOrders")}</h2>
            <OrderTicker orders={v.latest} locale={locale} base="/vendor/orders" label={t("latestOrders")} statusLabel={(s) => ts(s)} />
          </section>
        )}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="tile gloss tone-violet motion-rise" style={{ ["--i" as string]: 3 }}>
            <CardHeader><CardTitle>{t("topProducts")}</CardTitle></CardHeader>
            <CardContent><TopBars rows={v.top.map((r) => ({ label: pickLocalized(r.name as Record<string, string>, locale), value: r.net }))} locale={locale} empty={t("noOrders")} /></CardContent>
          </Card>
          <Card className="tile gloss tone-teal motion-rise" style={{ ["--i" as string]: 4 }}>
            <CardHeader><CardTitle>{t("deliveriesToday")}</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center gap-2">
              <ProgressRing value={d.total ? d.done / d.total : 0} size={140} stroke={13} label={t("deliveredOf", { done: d.done, total: d.total })}>
                <div className="text-3xl font-extrabold text-gradient"><CountUp value={d.done} fmt="int" locale={locale} /></div>
              </ProgressRing>
              <p className="text-sm">{t("deliveredOf", { done: d.done, total: d.total })}</p>
            </CardContent>
          </Card>
          <div className="grid gap-4">
            <Tile icon={ClipboardCheck} tone="tone-orange" label={t("newOrders")} value={v.toConfirm} locale={locale} href="/vendor/orders/incoming" i={5} />
            <Tile icon={Wallet} tone="tone-blue" label={t("payout30")} value={v.payout30} fmt="money" locale={locale} hint={t("ordersCount", { count: v.orders30 })} href="/vendor/finance/statements" i={6} />
            {card && card.score !== null
              ? <Tile icon={Star} tone="tone-pink" label={t("yourScore")} value={card.score} locale={locale} i={7} testId="supplier-score"
                  hint={card.rating !== null ? t("ratingHint", { rating: card.rating.toFixed(1), count: card.ratingCount }) : undefined} />
              : <Tile icon={Users} tone="tone-pink" label={t("teamMembers")} value={o.members} locale={locale} href="/vendor/company/users" i={7} />}
          </div>
        </div>
        {v.routes.length > 0 && (
          <Card className="motion-rise" style={{ ["--i" as string]: 8 }}>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>{t("routesOnRoad")}</CardTitle><LiveDot label={t("live")} /></CardHeader>
            <CardContent><RouteMap routes={v.routes.map((r) => ({ ...r, href: `/vendor/fleet/routes/${r.id}` }))} label={t("routesOnRoad")} height={260} legend={{ depot: t("mapDepot"), done: t("mapDone"), todo: t("mapTodo") }} /></CardContent>
          </Card>
        )}
      </div>
    );
  }

  const b = await buyerLive(ctx);
  const hm = (dt: Date) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(dt);
  return (
    <div className="space-y-5">
      <AutoRefresh seconds={60} />
      {head(<>
        <HeroStat label={t("inProgress")} value={b.inProgress} locale={locale} href="/buy/orders/history" i={0} />
        <HeroStat label={t("onTheWay")} value={b.onTheWay.length} locale={locale} i={1} />
        <HeroStat label={t("spend30")} value={b.spend30} fmt="money" locale={locale} sub={<Trend cur={b.spend30} prev={b.spendPrev} label={t("vsPrev")} />} i={2} />
        <HeroStat label={t("openInvoices")} value={b.openInvoices} fmt="money" locale={locale} href="/buy/finance/invoices" sub={b.overdue > 0 ? t("overdueAmount", { amount: new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(b.overdue) }) : undefined} i={3} />
      </>, { values: b.series.map((x) => x.net), total: b.series.reduce((a, x) => a + x.net, 0), label: t("spendTrend") })}
      {b.latest.length > 0 && (
        <section className="motion-rise" style={{ ["--i" as string]: 2 }}>
          <h2 className="mb-2 text-sm font-semibold text-[color:color-mix(in_oklch,var(--vivid-violet)_75%,var(--foreground))]">{t("latestOrders")}</h2>
          <OrderTicker orders={b.latest} locale={locale} base="/buy/orders" label={t("latestOrders")} statusLabel={(s) => ts(s)} />
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="tile gloss tone-teal motion-rise" style={{ ["--i" as string]: 3 }} data-testid="on-the-way">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>{t("onTheWay")}</CardTitle><Truck className="size-5 text-[color:var(--vivid-teal)] motion-float" aria-hidden /></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {b.onTheWay.map((x) => (
              <Link key={x.id} href={`/buy/orders/${x.order.id}`} className="flex items-center gap-2 rounded-lg border bg-card/70 p-2 hover:border-[color:var(--vivid-teal)]">
                <LiveDot color="var(--vivid-teal)" />
                <span className="font-semibold">{x.order.number}</span><span className="truncate text-muted-foreground">{x.supplier}</span>
                <span className="ml-auto text-xs font-medium">{x.eta ? t("expected", { from: hm(new Date(x.eta.getTime() - 1800_000)), to: hm(new Date(x.eta.getTime() + 1800_000)) }) : ts(x.status === "ASSIGNED" ? "SUPPLIER_PROCESSING" : "OUT_FOR_DELIVERY")}</span>
              </Link>
            ))}
            {!b.onTheWay.length && <p className="py-6 text-center text-muted-foreground">{t("noneOnTheWay")}</p>}
          </CardContent>
        </Card>
        <Card className="tile gloss tone-pink motion-rise" style={{ ["--i" as string]: 4 }}>
          <CardHeader><CardTitle>{t("topBought")}</CardTitle></CardHeader>
          <CardContent><TopBars rows={b.top.map((r) => ({ label: pickLocalized(r.name as Record<string, string>, locale), value: r.net }))} locale={locale} empty={t("noOrders")} /></CardContent>
        </Card>
        <div className="grid gap-4">
          {can(ctx, ["buyer.catalogue.view", "buyer.orders.place"]) && <Tile icon={ShoppingCart} tone="tone-blue" label={t("shopNow")} locale={locale} href="/buy/catalogue/browse" hint={t("ordersCount", { count: b.orders30 })} i={5} />}
          <Tile icon={FileText} tone="tone-orange" label={t("openInvoices")} value={b.openInvoices} fmt="money" locale={locale} href="/buy/finance/invoices" i={6} />
          <Tile icon={PackageCheck} tone="tone-violet" label={t("inProgress")} value={b.inProgress} locale={locale} href="/buy/orders/history" i={7} />
        </div>
      </div>
    </div>
  );
}
