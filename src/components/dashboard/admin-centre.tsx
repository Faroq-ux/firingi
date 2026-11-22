/** FIRINGI admin dashboard panels with more information (Phase 59), in the viewer's language (messages › adminDash). */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Info } from "lucide-react";
import type { AdminCentre } from "@/server/data/admin-centre";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/motion/shapes";
import { CountUp } from "@/components/motion/count-up";
import { formatMoney } from "@/lib/utils";

type T = Awaited<ReturnType<typeof getTranslations<"adminDash">>>;
const tr = () => getTranslations("adminDash");
const eur = (v: number, locale: string) => formatMoney(v, locale);
const pctText = (v: number, locale: string) => v.toLocaleString(locale, { maximumFractionDigits: 1 });

/** ▲ 12.3% / ▼ 4% next to a figure, green when it moves the good way, red otherwise. */
function Delta({ pct, t, locale, upIsGood = true }: { pct: number | null; t: T; locale: string; upIsGood?: boolean }) {
  if (pct == null) return <span className="text-xs text-muted-foreground">{t("newThisMonth")}</span>;
  const up = pct >= 0, good = up === upIsGood;
  return (
    <span className={`text-xs font-semibold tabular-nums ${pct === 0 ? "text-muted-foreground" : good ? "delta-pos" : "delta-neg"}`}>
      {pct === 0 ? "=" : up ? "▲" : "▼"} {pctText(Math.abs(pct), locale)}%<span className="ml-1 font-normal text-muted-foreground">{t("vsSame")}</span>
    </span>
  );
}

const Head = ({ title, href, link }: { title: string; href?: string; link?: string }) => (
  <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
    <CardTitle className="text-[15px]">{title}</CardTitle>
    {href && link && <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{link} <ArrowRight className="size-3" /></Link>}
  </CardHeader>
);

export async function SalesPanel({ d, locale }: { d: AdminCentre; locale: string }) {
  const t = await tr();
  const s = d.sales;
  const avgPct = s.avgOrderBefore ? Math.round(((s.avgOrder - s.avgOrderBefore) / s.avgOrderBefore) * 1000) / 10 : null;
  const cells = [
    { label: t("sales"), value: <CountUp value={s.net} fmt="money" locale={locale} />, pct: s.netChange, sub: t("lastMonth", { value: eur(s.netBefore, locale) }) },
    { label: t("orders"), value: <CountUp value={s.orders} fmt="int" locale={locale} />, pct: s.ordersChange, sub: t("lastMonth", { value: String(s.ordersBefore) }) },
    { label: t("margin"), value: <CountUp value={s.margin} fmt="money" locale={locale} />, pct: s.marginChange, sub: s.marginPct != null ? t("ofSales", { pct: pctText(s.marginPct, locale) }) : "—" },
    { label: t("avgOrder"), value: <CountUp value={s.avgOrder} fmt="money" locale={locale} />, pct: avgPct, sub: t("lastMonth", { value: eur(s.avgOrderBefore, locale) }) },
  ];
  return (
    <Card className="@container motion-rise h-full" data-testid="centre-sales">
      <Head title={t("monthSoFar")} href="/admin/analytics/sales" link={t("analytics")} />
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {cells.map((c, i) => (
            <div key={c.label} className="tile gloss stat-card rounded-xl border p-3" style={{ ["--i" as string]: i }}>
              <p className="kpi-label text-xs text-muted-foreground">{c.label}</p>
              <p className="kpi-value">{c.value}</p>
              <div><Delta pct={c.pct} t={t} locale={locale} /></div>
              <p className="kpi-hint text-[11px] text-muted-foreground">{c.sub}</p>
            </div>
          ))}
        </div>
        {s.daily.length > 1 && <div><p className="mb-1 text-xs text-muted-foreground">{t("salesPerDay")}</p><Sparkline values={s.daily.map((x) => x.net)} label={t("salesPerDay")} height={56} /></div>}
      </CardContent>
    </Card>
  );
}

export async function MoneyPanel({ d, locale }: { d: AdminCentre; locale: string }) {
  const m = d.money;
  if (!m) return null;
  const t = await tr();
  const rows = [
    { label: t("owe"), value: m.receivable, note: t("openInvoices", { count: m.receivableCount }), href: "/admin/finance/receivable", tone: "" },
    { label: t("overdue"), value: m.overdue, note: t("pastDue", { count: m.overdueCount }), href: "/admin/finance/receivable", tone: m.overdue > 0 ? "delta-neg" : "" },
    { label: t("payoutsDue"), value: m.payoutsDue, note: t("invoices", { count: m.payoutCount }), href: "/admin/finance/payouts-due", tone: "" },
    { label: t("payoutsOverdue"), value: m.payoutsOverdue, note: m.earlyPayouts ? t("earlyRequests", { count: m.earlyPayouts }) : t("payFirst"), href: "/admin/finance/payouts-due", tone: m.payoutsOverdue > 0 ? "delta-neg" : "" },
    { label: t("received"), value: m.received, note: t("confirmedPayments"), href: "/admin/finance/customer-payments", tone: "delta-pos" },
  ];
  return (
    <Card className="motion-rise h-full" data-testid="centre-money">
      <Head title={t("money")} href="/admin/finance/overview" link={t("finance")} />
      <CardContent>
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.label}>
              <Link href={r.href} className="flex items-baseline justify-between gap-3 py-2 hover:text-primary">
                <span className="min-w-0"><span className="block text-sm">{r.label}</span><span className="block text-[11px] text-muted-foreground">{r.note}</span></span>
                <span className={`shrink-0 font-semibold tabular-nums ${r.tone}`}>{eur(r.value, locale)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const LEVEL = { neg: { icon: CircleAlert, chip: "chip-neg", tone: "delta-neg" }, warn: { icon: AlertTriangle, chip: "chip-warn", tone: "delta-warn" }, info: { icon: Info, chip: "chip-info", tone: "text-primary" } } as const;
export async function ActionsPanel({ d }: { d: AdminCentre }) {
  const t = await tr();
  return (
    <Card className="motion-rise h-full" data-testid="centre-actions">
      <Head title={t("needsAction")} />
      <CardContent>
        {d.actions.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-5 delta-pos" /> {t("nothingWaiting")}</p>
        ) : (
          <ul className="space-y-1.5">
            {d.actions.map((a) => {
              const L = LEVEL[a.level];
              return (
                <li key={a.key}>
                  <Link href={a.href} className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-sm transition-colors hover:bg-accent" data-action={a.key}>
                    <L.icon className={`size-4 shrink-0 ${L.tone}`} aria-hidden />
                    <span className="min-w-0 flex-1">{t(`action.${a.key}` as "action.exceptions")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${L.chip}`}>{a.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const STEP: Record<string, { href: string; color: string }> = {
  NEW: { href: "/admin/orders/new", color: "var(--primary)" },
  PENDING_CONFIRMATION: { href: "/admin/orders/pending-confirmation", color: "oklch(0.75 0.14 75)" },
  SUPPLIER_PROCESSING: { href: "/admin/orders/supplier-processing", color: "var(--primary)" },
  READY_FOR_PICKUP: { href: "/admin/orders/ready-for-pickup", color: "var(--primary)" },
  DISPATCHED: { href: "/admin/orders/dispatched", color: "var(--primary)" },
  OUT_FOR_DELIVERY: { href: "/admin/orders/out-for-delivery", color: "var(--vivid-violet)" },
  ON_HOLD: { href: "/admin/risk/suspicious-orders", color: "oklch(0.6 0.19 25)" },
  EXCEPTION: { href: "/admin/orders/exceptions", color: "oklch(0.6 0.19 25)" },
};
export async function PipelinePanel({ d }: { d: AdminCentre }) {
  const t = await tr();
  const max = Math.max(1, ...d.pipeline.steps.map((s) => s.count));
  return (
    <Card className="@container motion-rise h-full" data-testid="centre-pipeline">
      <Head title={t("inProgress")} href="/admin/orders/all" link={t("allOrders")} />
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 @4xl:grid-cols-9">
          {d.pipeline.steps.map((s, i) => {
            const st = STEP[s.status];
            const label = t(`step.${s.status}` as "step.NEW");
            return (
              <Link key={s.status} href={st.href} className="rounded-xl border p-2.5 transition-colors hover:bg-accent" data-step={s.status}>
                <p className="truncate text-[11px] text-muted-foreground" title={label}>{label}</p>
                <p className="text-xl font-bold tabular-nums">{s.count}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="motion-grow-x h-full rounded-full" style={{ width: `${Math.round((s.count / max) * 100)}%`, background: st.color, ["--i" as string]: i }} /></div>
              </Link>
            );
          })}
          <Link href="/admin/orders/delivered" className="rounded-xl border p-2.5 transition-colors hover:bg-accent">
            <p className="truncate text-[11px] text-muted-foreground">{t("deliveredToday")}</p>
            <p className="text-xl font-bold tabular-nums delta-pos">{d.pipeline.deliveredToday}</p>
            <div className="mt-1 h-1.5 rounded-full chip-pos" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

type TopRow = { id: string; name: string; sub: string; net: number; count: string };
function TopList({ title, rows, href, locale, testId, empty }: { title: string; rows: TopRow[]; href: (r: TopRow) => string; locale: string; testId: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.net));
  return (
    <div className="min-w-0" data-testid={testId}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id}>
              <Link href={href(r)} className="block rounded-lg px-1 py-0.5 hover:bg-accent">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate"><span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>{r.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{eur(r.net, locale)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><div className="motion-grow-x h-full rounded-full bg-primary" style={{ width: `${Math.round((r.net / max) * 100)}%`, ["--i" as string]: i }} /></div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{r.sub} · {r.count}</span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
export async function TopPanel({ d, locale }: { d: AdminCentre; locale: string }) {
  const t = await tr();
  const type = (x: string) => (["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"].includes(x) ? t(`type.${x}` as "type.CUSTOMER") : "");
  return (
    <Card className="@container motion-rise h-full">
      <Head title={t("best")} href="/admin/analytics/sales" link={t("analytics")} />
      <CardContent className="grid gap-6 @2xl:grid-cols-3">
        <TopList title={t("suppliers")} testId="centre-top-suppliers" empty={t("noSales")} locale={locale} rows={d.topSuppliers.map((r) => ({ id: r.id, name: r.name, net: r.net, sub: `${r.flag} ${type(r.type)}`, count: t("ordersCount", { count: r.orders }) }))} href={(r) => `/admin/companies/${r.id}`} />
        <TopList title={t("customers")} testId="centre-top-customers" empty={t("noSales")} locale={locale} rows={d.topCustomers.map((r) => ({ id: r.id, name: r.name, net: r.net, sub: `${r.flag} ${type(r.type)}`, count: t("ordersCount", { count: r.orders }) }))} href={(r) => `/admin/companies/${r.id}`} />
        <TopList title={t("products")} testId="centre-top-products" empty={t("noSales")} locale={locale} rows={d.topProducts.map((r) => ({ id: r.offerId, name: `${r.name}${r.pack ? ` · ${r.pack}` : ""}`, sub: r.supplier, net: r.net, count: t("unitsCount", { count: r.qty }) }))} href={() => "/admin/catalogue/products"} />
      </CardContent>
    </Card>
  );
}

export async function SplitPanel({ d, locale }: { d: AdminCentre; locale: string }) {
  const t = await tr();
  const channel = (c: string) => (["WEB", "APP", "WHATSAPP", "API", "POS", "RECURRING"].includes(c) ? t(`channel.${c}` as "channel.WEB") : c);
  return (
    <Card className="@container motion-rise h-full">
      <Head title={t("whereFrom")} />
      <CardContent className="grid gap-5 @xl:grid-cols-2">
        <div data-testid="centre-countries">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("byCountry")}</h3>
          {d.byCountry.length === 0 ? <p className="text-sm text-muted-foreground">{t("noSales")}</p> : (
            <ul className="space-y-2">
              {d.byCountry.map((c, i) => (
                <li key={c.code}>
                  <div className="flex justify-between gap-2 text-sm"><span>{c.flag} {c.name}</span><span className="font-semibold tabular-nums">{eur(c.net, locale)}</span></div>
                  <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="motion-grow-x h-full rounded-full bg-[var(--vivid-blue)]" style={{ width: `${c.share}%`, ["--i" as string]: i }} /></div><span className="w-12 text-right text-[11px] text-muted-foreground tabular-nums">{pctText(c.share, locale)}%</span></div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div data-testid="centre-channels">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("byChannel")}</h3>
          {d.byChannel.length === 0 ? <p className="text-sm text-muted-foreground">{t("noOrders")}</p> : (
            <ul className="space-y-2">
              {d.byChannel.map((c, i) => (
                <li key={c.channel}>
                  <div className="flex justify-between gap-2 text-sm"><span>{channel(c.channel)}</span><span className="tabular-nums"><b>{c.orders}</b> <span className="text-muted-foreground">· {eur(c.net, locale)}</span></span></div>
                  <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="motion-grow-x h-full rounded-full bg-[var(--vivid-pink)]" style={{ width: `${c.share}%`, ["--i" as string]: i }} /></div><span className="w-12 text-right text-[11px] text-muted-foreground tabular-nums">{pctText(c.share, locale)}%</span></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export async function HealthPanel({ d }: { d: AdminCentre }) {
  const h = d.health;
  if (!h) return null;
  const t = await tr();
  const tone = { ok: "chip-pos", warning: "chip-warn", critical: "chip-neg" }[h.status];
  return (
    <Card className="motion-rise h-full" data-testid="centre-health">
      <Head title={t("health")} href="/admin/settings/system-health" link={t("systemHealth")} />
      <CardContent className="space-y-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${tone}`}>{h.status === "ok" ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}{t(h.status)}</span>
        {h.problems.length > 0 && (
          <ul className="space-y-1 text-sm">
            {h.problems.map((p) => <li key={p.label} className="flex gap-2"><span className={p.state === "critical" ? "delta-neg" : "delta-warn"}>●</span><span className="min-w-0"><b className="font-medium">{p.label}</b>{p.detail && <span className="block truncate text-xs text-muted-foreground">{p.detail}</span>}</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
