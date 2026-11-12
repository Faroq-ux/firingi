/** Accounting pages shared by the buy and sell portals (Phase 27). Texts: "accounting". */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, BookOpenCheck, CalendarClock, Coins, FileText, HandCoins, Lock, Paperclip, PiggyBank, Plus, Receipt, Scale, Wallet } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { pagePermission } from "@/server/rbac/guard";
import { companyFeatureOn } from "@/server/accounting/features";
import { accountingScope, listEntries, listRecurringExpenses } from "@/server/accounting/entries";
import { accountingDashboard, periodOf, previousPeriod, profitAndLoss, type Basis, type Granularity } from "@/server/accounting/pnl";
import { branchOptions } from "@/server/multisite/branches";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Aurora } from "@/components/motion/shapes";
import { HeroStat } from "@/components/motion/dashboard-kit";
import { Kpi } from "@/components/analytics/kit";
import { BarList, ChartCard, TimeChart } from "@/components/analytics/charts";
import { DailyCloseForm, DeleteEntry, ExpenseForm, PrintButton, RecurringExpenseForm, RecurringToggle } from "./controls";
import { formatMoney } from "@/lib/utils";

type Portal = "buy" | "vendor";
type SP = Record<string, string | undefined>;
const base = (p: Portal) => (p === "buy" ? "/buy/accounting" : "/vendor/accounting");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date());

async function gate(ctx: Ctx): Promise<ReactNode | null> {
  pagePermission(ctx, ["company.accounting.view", "company.accounting.manage"]);
  if (await companyFeatureOn(ctx.company.id, "ACCOUNTING")) return null;
  const t = await getTranslations("accounting");
  return (
    <>
      <PageHeader title={t("title")} icon={BookOpenCheck} />
      <Card data-testid="accounting-off"><CardContent className="flex items-start gap-3 py-8"><Lock className="mt-0.5 size-5 text-muted-foreground" /><div><p className="font-medium">{t("offTitle")}</p><p className="text-sm text-muted-foreground">{t("offBody")}</p></div></CardContent></Card>
    </>
  );
}

async function shopsFor(ctx: Ctx) {
  const [shops, scope] = await Promise.all([branchOptions(ctx), accountingScope(ctx)]);
  return { shops, mustPickShop: !!scope };
}

/** Shop + with/without VAT filter (GET form, works without JavaScript). */
async function Filters({ shops, sp, extra, keep }: { shops: { id: string; label: string }[]; sp: SP; extra?: ReactNode; keep?: Record<string, string> }) {
  const t = await getTranslations("accounting");
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2 print:hidden" data-testid="acc-filters">
      {Object.entries(keep ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {extra}
      {shops.length > 0 && (
        <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t("shop")}</span>
          <select name="shop" defaultValue={sp.shop ?? ""} className="h-9 rounded-md border bg-card px-2 text-sm text-foreground"><option value="">{t("allShops")}</option><option value="NONE">{t("companyLevel")}</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
      )}
      <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t("amounts")}</span>
        <select name="basis" defaultValue={sp.basis === "NET" ? "NET" : "GROSS"} className="h-9 rounded-md border bg-card px-2 text-sm text-foreground"><option value="GROSS">{t("withVat")}</option><option value="NET">{t("withoutVat")}</option></select>
      </label>
      <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-accent">{t("show")}</button>
    </form>
  );
}

const QuickLinks = async ({ portal }: { portal: Portal }) => {
  const t = await getTranslations("accounting");
  const b = base(portal);
  const cls = "inline-flex h-9 items-center gap-2 rounded-md border bg-card/80 px-3 text-sm font-medium hover:bg-accent";
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Link href={`${b}/sales`} className={`${cls} border-transparent bg-[linear-gradient(135deg,var(--vivid-teal),var(--vivid-blue))] text-white hover:opacity-90`}><HandCoins className="size-4" />{t("closeTheDay")}</Link>
      <Link href={`${b}/expenses`} className={cls}><Plus className="size-4" />{t("addExpense")}</Link>
      <Link href={`${b}/profit-loss`} className={cls}><Scale className="size-4" />{t("pnlTitle")}</Link>
    </div>
  );
};

// ───────────────────────────── dashboard ─────────────────────────────

export async function AccountingOverview({ ctx, portal, sp }: { ctx: Ctx; portal: Portal; sp: SP }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale, { shops }] = await Promise.all([getTranslations("accounting"), getLocale(), shopsFor(ctx)]);
  const basis: Basis = sp.basis === "NET" ? "NET" : "GROSS";
  const d = await accountingDashboard(ctx, basis, sp.shop || undefined);
  const n = (v: string) => Number(v);
  const label = (k: string) => t(`cat.${k}`);
  const mFmt = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" });
  const profitTone = (v: string) => (n(v) >= 0 ? "text-[color:var(--success,#16a34a)]" : "text-destructive");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} icon={BookOpenCheck} actions={<QuickLinks portal={portal} />} />
      <Filters shops={shops} sp={sp} />
      <Aurora className="mb-6 rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between gap-2 text-white"><p className="text-sm font-semibold uppercase tracking-wider text-white/80">{t("profit")}</p><span className="text-xs text-white/70">{basis === "NET" ? t("withoutVat") : t("withVat")}</span></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="profit-hero">
          <HeroStat label={t("today")} value={n(d.today.profit)} fmt="money" locale={locale} i={0} sub={<>{t("salesShort")} {formatMoney(d.today.sales, locale)} · {t("costsShort")} {formatMoney(d.today.costs, locale)}</>} />
          <HeroStat label={t("thisWeek")} value={n(d.week.profit)} fmt="money" locale={locale} i={1} sub={<>{t("salesShort")} {formatMoney(d.week.sales, locale)} · {t("costsShort")} {formatMoney(d.week.costs, locale)}</>} />
          <HeroStat label={t("thisMonthNamed", { month: mFmt.format(d.month.from) })} value={n(d.month.profit)} fmt="money" locale={locale} i={2} sub={<>{t("salesShort")} {formatMoney(d.month.sales, locale)} · {t("costsShort")} {formatMoney(d.month.costs, locale)}</>} />
        </div>
      </Aurora>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("salesMonth")} value={n(d.month.sales)} prev={d.month.previous ? n(d.month.previous.sales) : undefined} fmt="money" locale={locale} vsLabel={t("vsLastMonth")} tone="tone-teal" index={0} testId="kpi-sales" />
        <Kpi label={t("costsMonth")} value={n(d.month.costs)} prev={d.month.previous ? n(d.month.previous.costs) : undefined} fmt="money" locale={locale} vsLabel={t("vsLastMonth")} tone="tone-pink" index={1} testId="kpi-costs" />
        <Kpi label={t("profitMonth")} value={n(d.month.profit)} prev={d.month.previous ? n(d.month.previous.netProfit) : undefined} fmt="money" locale={locale} vsLabel={t("vsLastMonth")} tone="tone-violet" index={2} testId="kpi-profit" />
        <Kpi label={t("margin")} value={(d.month.margin ?? 0) / 100} fmt="percent" locale={locale} tone="tone-orange" index={3} hint={d.month.margin === null ? t("noSalesYet") : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title={t("trendTitle")} description={t("trendHint")} labels={{ chart: t("chart"), table: t("table") }}
          table={{ head: [t("month"), t("sales"), t("costs"), t("profit")], rows: d.trend.map((p) => [mFmt.format(new Date(`${p.key}-01T00:00:00Z`)), formatMoney(p.sales, locale), formatMoney(p.costs, locale), formatMoney(p.profit, locale)]), align: ["left", "right", "right", "right"] }}>
          <TimeChart points={d.trend.map((p) => p.key)} grain="month" fmt="money" locale={locale} kind="bar" testId="trend-chart"
            series={[{ key: "sales", label: t("sales"), values: d.trend.map((p) => p.sales) }, { key: "costs", label: t("costs"), values: d.trend.map((p) => p.costs) }, { key: "profit", label: t("profit"), values: d.trend.map((p) => p.profit) }]} />
        </ChartCard>
        <ChartCard title={t("costsByCategory")} description={t("thisMonth")} labels={{ chart: t("chart"), table: t("table") }}
          table={{ head: [t("category"), t("amount")], rows: d.costLines.map((c) => [label(c.key), formatMoney(c.amount, locale)]), align: ["left", "right"] }}>
          <BarList rows={d.costLines.map((c) => ({ key: c.key, label: label(c.key), value: n(c.amount) }))} fmt="money" locale={locale} testId="cost-bars" emptyText={t("noCosts")} />
        </ChartCard>
      </div>
      {d.branches.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>{t("byShop")}</CardTitle><CardDescription>{t("thisMonth")}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="profit-by-shop">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("shop")}</th><th className="py-1 pr-3 text-right font-medium">{t("sales")}</th><th className="py-1 pr-3 text-right font-medium">{t("costs")}</th><th className="py-1 text-right font-medium">{t("profit")}</th></tr></thead>
              <tbody>{d.branches.map((b) => <tr key={b.id ?? "none"} className="border-t"><td className="py-2 pr-3">{b.name ?? t("companyLevel")}</td><td className="py-2 pr-3 text-right tabular-nums">{formatMoney(b.sales, locale)}</td><td className="py-2 pr-3 text-right tabular-nums">{formatMoney(b.costs, locale)}</td><td className={`py-2 text-right font-semibold tabular-nums ${profitTone(b.profit)}`}>{formatMoney(b.profit, locale)}</td></tr>)}</tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <Card className="mt-6">
        <CardHeader><CardTitle>{t("latest")}</CardTitle></CardHeader>
        <CardContent>
          {d.recent.length === 0 ? <p className="text-sm text-muted-foreground">{t("nothingYet")}</p> : (
            <ul className="divide-y" data-testid="recent-entries">
              {d.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">{r.kind === "SALE" ? <ArrowUpRight className="size-4 shrink-0 text-[color:var(--success,#16a34a)]" /> : <ArrowDownRight className="size-4 shrink-0 text-destructive" />}<span className="truncate">{label(r.category)}{r.payee ? ` · ${r.payee}` : ""}{r.branch ? <span className="text-muted-foreground"> · {r.branch}</span> : ""}</span></span>
                  <span className="shrink-0 tabular-nums">{date.format(r.date)} · <b>{formatMoney(r.amount, locale)}</b></span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ───────────────────────────── daily sales ─────────────────────────────

export async function AccountingSales({ ctx, portal, sp }: { ctx: Ctx; portal: Portal; sp: SP }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale, { shops, mustPickShop }] = await Promise.all([getTranslations("accounting"), getLocale(), shopsFor(ctx)]);
  const manage = ctx.permissions.has("company.accounting.manage");
  const to = new Date(), from = new Date(Date.now() - 30 * 86_400_000);
  const rows = await listEntries(ctx, { from, to, kind: "SALE", branch: sp.shop || undefined });
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(iso(r.date), (byDay.get(iso(r.date)) ?? 0) + Number(r.amount));
  const days = [...byDay.keys()].sort();
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  return (
    <>
      <PageHeader title={t("salesTitle")} description={t("salesIntro")} icon={HandCoins} actions={<QuickLinks portal={portal} />} />
      {manage && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{t("closeTheDay")}</CardTitle><CardDescription>{t("closeTheDayHint")}</CardDescription></CardHeader>
          <CardContent><DailyCloseForm shops={shops} mustPickShop={mustPickShop} today={iso(new Date())} locale={locale} /></CardContent>
        </Card>
      )}
      <Filters shops={shops} sp={sp} />
      {days.length > 1 && (
        <ChartCard className="mb-6" title={t("last30")} labels={{ chart: t("chart"), table: t("table") }} table={{ head: [t("date"), t("sales")], rows: days.map((k) => [date.format(new Date(`${k}T00:00:00Z`)), formatMoney(byDay.get(k)!, locale)]), align: ["left", "right"] }}>
          <TimeChart points={days} grain="day" fmt="money" locale={locale} kind="bar" height={200} series={[{ key: "sales", label: t("sales"), values: days.map((k) => byDay.get(k)!) }]} />
        </ChartCard>
      )}
      <DataTable tableId={`${portal}.acc.sales`} testId="sales-table" empty={t("noSales")}
        columns={[{ key: "date", label: t("date"), type: "date" }, { key: "method", label: t("method"), filter: true }, ...(shops.length ? [{ key: "shop", label: t("shop"), filter: true }] : []), { key: "amount", label: t("amount"), type: "money" as const }, { key: "vat", label: t("vatRate") }, { key: "by", label: t("enteredBy") }, ...(manage ? [{ key: "x", label: "" }] : [])]}
        rows={rows.map((r) => ({ id: r.id, cells: { date: { t: date.format(r.date), v: iso(r.date) }, method: t(`cat.${r.category}`), shop: r.branch ?? t("companyLevel"), amount: { t: formatMoney(r.amount, locale), v: Number(r.amount) }, vat: r.vatRate ? `${Number(r.vatRate)} %` : "—", by: r.createdBy ?? "—", x: manage ? { t: "", node: <DeleteEntry id={r.id} /> } : null } }))} />
    </>
  );
}

// ───────────────────────────── expenses ─────────────────────────────

export async function AccountingExpenses({ ctx, portal, sp }: { ctx: Ctx; portal: Portal; sp: SP }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale, { shops, mustPickShop }] = await Promise.all([getTranslations("accounting"), getLocale(), shopsFor(ctx)]);
  const manage = ctx.permissions.has("company.accounting.manage");
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? new Date(`${sp.month}-01T00:00:00Z`) : new Date();
  const p = periodOf("MONTH", month);
  const [rows, recurring] = await Promise.all([listEntries(ctx, { ...p, kind: "EXPENSE", branch: sp.shop || undefined }), listRecurringExpenses(ctx)]);
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" });
  const mFmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1)); return iso(d).slice(0, 7); });
  const b = base(portal);
  return (
    <>
      <PageHeader title={t("expensesTitle")} description={t("expensesIntro")} icon={Wallet} actions={<QuickLinks portal={portal} />} />
      {manage && (
        <div className="mb-6 grid gap-6 2xl:grid-cols-2">
          <Card><CardHeader><CardTitle>{t("addExpense")}</CardTitle><CardDescription>{t("addExpenseHint")}</CardDescription></CardHeader><CardContent><ExpenseForm shops={shops} mustPickShop={mustPickShop} today={iso(new Date())} /></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" />{t("recurringTitle")}</CardTitle><CardDescription>{t("recurringIntro")}</CardDescription></CardHeader><CardContent><RecurringExpenseForm shops={shops} mustPickShop={mustPickShop} today={iso(new Date())} /></CardContent></Card>
        </div>
      )}
      {recurring.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{t("fixedMonthly")}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="recurring-list">
              {recurring.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-center justify-between gap-3 py-2 text-sm ${r.isActive ? "" : "opacity-60"}`}>
                  <span className="min-w-0"><b>{t(`cat.${r.category}`)}</b>{r.payee ? ` · ${r.payee}` : ""}{r.branch ? <span className="text-muted-foreground"> · {r.branch}</span> : ""}<span className="block text-xs text-muted-foreground">{t("everyMonthOn", { day: r.dayOfMonth })} · {t("addedTimes", { count: r.entries })}{!r.isActive ? ` · ${t("stopped")}` : ""}</span></span>
                  <span className="flex items-center gap-2"><b className="tabular-nums">{formatMoney(r.amount, locale)}</b>{manage && <RecurringToggle id={r.id} isActive={r.isActive} />}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Filters shops={shops} sp={sp} keep={{}} extra={
        <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t("month")}</span>
          <select name="month" defaultValue={iso(p.from).slice(0, 7)} className="h-9 rounded-md border bg-card px-2 text-sm text-foreground">{months.map((m) => <option key={m} value={m}>{mFmt.format(new Date(`${m}-01T00:00:00Z`))}</option>)}</select>
        </label>} />
      <p className="mb-3 text-sm">{t("monthTotal", { month: mFmt.format(p.from) })}: <b className="tabular-nums" data-testid="expenses-total">{formatMoney(total, locale)}</b></p>
      <DataTable tableId={`${portal}.acc.expenses`} testId="expenses-table" empty={t("noExpenses")}
        columns={[{ key: "date", label: t("date"), type: "date" }, { key: "category", label: t("category"), filter: true }, { key: "payee", label: t("payee") }, ...(shops.length ? [{ key: "shop", label: t("shop"), filter: true }] : []), { key: "amount", label: t("amount"), type: "money" as const }, { key: "vat", label: t("vatRate") }, { key: "receipt", label: t("receipt") }, ...(manage ? [{ key: "x", label: "" }] : [])]}
        rows={rows.map((r) => ({
          id: r.id,
          cells: {
            date: { t: date.format(r.date), v: iso(r.date) }, category: { t: t(`cat.${r.category}`), sub: r.recurring ? t("fixed") : r.description ?? undefined }, payee: r.payee ?? "—", shop: r.branch ?? t("companyLevel"),
            amount: { t: formatMoney(r.amount, locale), v: Number(r.amount) }, vat: r.vatRate ? `${Number(r.vatRate)} %` : "—",
            receipt: r.hasReceipt ? { t: t("open"), node: <a href={`/api/accounting/receipts/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline" rel="noreferrer"><Paperclip className="size-3.5" />{t("open")}</a> } : "—",
            x: manage ? { t: "", node: <DeleteEntry id={r.id} /> } : null,
          },
        }))} />
      <p className="mt-4 text-xs text-muted-foreground print:hidden"><Link href={`${b}/profit-loss?g=MONTH&d=${iso(p.from)}`} className="hover:underline">{t("seePnl")} →</Link></p>
    </>
  );
}

// ───────────────────────────── profit & loss ─────────────────────────────

export async function AccountingPnl({ ctx, portal, sp }: { ctx: Ctx; portal: Portal; sp: SP }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale, { shops }] = await Promise.all([getTranslations("accounting"), getLocale(), shopsFor(ctx)]);
  const g: Granularity = sp.g === "DAY" || sp.g === "WEEK" ? sp.g : "MONTH";
  const at = parseDay(sp.d);
  const basis: Basis = sp.basis === "NET" ? "NET" : "GROSS";
  const p = periodOf(g, at), prev = previousPeriod(g, p.from);
  const r = await profitAndLoss(ctx, { ...p, basis, branch: sp.shop || undefined });
  const prevSt = await profitAndLoss(ctx, { ...prev, basis, branch: sp.shop || undefined });
  const money = (v: string | number) => formatMoney(v, locale);
  const fmtRange = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const title = g === "DAY" ? fmtRange.format(p.from) : g === "MONTH" ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(p.from) : `${fmtRange.format(p.from)} – ${fmtRange.format(p.to)}`;
  const step = (dir: -1 | 1) => iso(dir < 0 ? new Date(p.from.getTime() - 86_400_000) : new Date(p.to.getTime() + 86_400_000));
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ g, d: iso(at), ...(sp.shop ? { shop: sp.shop } : {}), basis, ...o })}`;
  const prevOf = (key: string, lines: { key: string; amount: string }[]) => lines.find((l) => l.key === key)?.amount ?? "0";
  const Row = ({ label, v, pv, strong, indent, tone, testId }: { label: string; v: string; pv?: string; strong?: boolean; indent?: boolean; tone?: string; testId?: string }) => (
    <tr className={`border-t ${strong ? "font-semibold" : ""}`} data-testid={testId}>
      <td className={`py-2 pr-3 ${indent ? "pl-4 text-muted-foreground" : ""}`}>{label}</td>
      <td className={`py-2 pr-3 text-right tabular-nums ${tone ?? ""}`}>{money(v)}</td>
      <td className="hidden py-2 text-right tabular-nums text-muted-foreground sm:table-cell">{pv !== undefined ? money(pv) : ""}</td>
    </tr>
  );
  const pos = (v: string) => (Number(v) >= 0 ? "text-[color:var(--success,#16a34a)]" : "text-destructive");
  const neg = (v: string) => (Number(v) === 0 ? "0" : `-${v}`);
  return (
    <>
      <PageHeader title={t("pnlTitle")} description={t("pnlIntro")} icon={Scale} actions={<div className="flex gap-2"><PrintButton /><QuickLinks portal={portal} /></div>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        {(["DAY", "WEEK", "MONTH"] as const).map((x) => <Link key={x} href={q({ g: x })} className={`rounded-full border px-3 py-1 text-sm ${x === g ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`} aria-current={x === g ? "page" : undefined}>{t(`gran.${x}`)}</Link>)}
        <span className="mx-1 h-5 w-px bg-border" />
        <Link href={q({ d: step(-1) })} className="rounded-md border px-2 py-1 text-sm hover:bg-accent" aria-label={t("previous")}>‹</Link>
        <span className="text-sm font-medium" data-testid="pnl-period">{title}</span>
        <Link href={q({ d: step(1) })} className="rounded-md border px-2 py-1 text-sm hover:bg-accent" aria-label={t("next")}>›</Link>
      </div>
      <Filters shops={shops} sp={sp} keep={{ g, d: iso(at) }} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("sales")} value={Number(r.sales.total)} prev={Number(prevSt.sales.total)} fmt="money" locale={locale} vsLabel={t("vsPrevious")} tone="tone-teal" index={0} />
        <Kpi label={t("costs")} value={Number(r.costsTotal)} prev={Number(prevSt.costsTotal)} fmt="money" locale={locale} vsLabel={t("vsPrevious")} tone="tone-pink" index={1} />
        <Kpi label={t("netProfit")} value={Number(r.netProfit)} prev={Number(prevSt.netProfit)} fmt="money" locale={locale} vsLabel={t("vsPrevious")} tone="tone-violet" index={2} testId="kpi-net-profit" />
        <Kpi label={t("margin")} value={(r.margin ?? 0) / 100} fmt="percent" locale={locale} tone="tone-orange" index={3} hint={r.margin === null ? t("noSalesYet") : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="size-4" />{t("statement")}</CardTitle><CardDescription>{basis === "NET" ? t("withoutVat") : t("withVat")}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="pnl-statement">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium" /><th className="py-1 pr-3 text-right font-medium">{title}</th><th className="hidden py-1 text-right font-medium sm:table-cell">{t("previousPeriod")}</th></tr></thead>
              <tbody>
                <Row label={t("sales")} v={r.sales.total} pv={prevSt.sales.total} strong testId="pnl-sales" />
                {r.sales.lines.map((l) => <Row key={l.key} label={t(`cat.${l.key}`)} v={l.amount} pv={prevOf(l.key, prevSt.sales.lines)} indent />)}
                <Row label={t("purchases")} v={neg(r.purchases.total)} pv={neg(prevSt.purchases.total)} strong testId="pnl-purchases" />
                {r.purchases.lines.map((l) => <Row key={l.key} label={t(`cat.${l.key}`)} v={neg(l.amount)} pv={neg(prevOf(l.key, prevSt.purchases.lines))} indent />)}
                <Row label={t("grossProfit")} v={r.grossProfit} pv={prevSt.grossProfit} strong tone={pos(r.grossProfit)} />
                <Row label={t("expenses")} v={neg(r.expenses.total)} pv={neg(prevSt.expenses.total)} strong testId="pnl-expenses" />
                {r.expenses.lines.map((l) => <Row key={l.key} label={t(`cat.${l.key}`)} v={neg(l.amount)} pv={neg(prevOf(l.key, prevSt.expenses.lines))} indent />)}
                <tr className="border-t-2 text-base font-bold" data-testid="pnl-net"><td className="py-3 pr-3">{t("netProfit")}</td><td className={`py-3 pr-3 text-right tabular-nums ${pos(r.netProfit)}`}>{money(r.netProfit)}</td><td className="hidden py-3 text-right tabular-nums text-muted-foreground sm:table-cell">{money(prevSt.netProfit)}</td></tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
        <div className="space-y-6 xl:col-span-2">
          <ChartCard title={t("byDay")} labels={{ chart: t("chart"), table: t("table") }} table={{ head: [t("date"), t("sales"), t("costs"), t("profit")], rows: r.series.map((s) => [s.key, money(s.sales), money(s.costs), money(s.profit)]), align: ["left", "right", "right", "right"] }}>
            <TimeChart points={r.series.map((s) => s.key)} grain={r.series[0]?.key.length === 7 ? "month" : "day"} fmt="money" locale={locale} kind="bar" height={200}
              series={[{ key: "sales", label: t("sales"), values: r.series.map((s) => s.sales) }, { key: "costs", label: t("costs"), values: r.series.map((s) => s.costs) }]} />
          </ChartCard>
          <Card data-testid="vat-box">
            <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="size-4" />{t("vatTitle")}</CardTitle><CardDescription>{t("vatHint")}</CardDescription></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="flex justify-between"><span>{t("vatOnSales")}</span><span className="tabular-nums">{money(r.vat.onSales)}</span></p>
              <p className="flex justify-between"><span>{t("vatOnPurchases")}</span><span className="tabular-nums">{money(neg(r.vat.onPurchases))}</span></p>
              <p className="flex justify-between border-t pt-1 font-semibold"><span>{Number(r.vat.balance) >= 0 ? t("vatToPay") : t("vatToRecover")}</span><span className="tabular-nums">{money(Math.abs(Number(r.vat.balance)))}</span></p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-3 pt-6 text-xs text-muted-foreground"><PiggyBank className="mt-0.5 size-4 shrink-0" /><span>{t("pnlNote")}</span></CardContent>
          </Card>
        </div>
      </div>
      <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground"><Coins className="size-3.5" />{t("privateNote")} <Badge variant="outline">{t("private")}</Badge></p>
    </>
  );
}
