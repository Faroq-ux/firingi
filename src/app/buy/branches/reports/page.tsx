import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { branchComparison, invoiceSummary, priceComparison } from "@/server/multisite/reports";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { BarList, ChartCard } from "@/components/analytics/charts";
import { BudgetBar } from "@/components/multisite/controls";
import { pctTone } from "@/lib/multisite";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Shop reports" };
const RANGES = ["month", "last", "3m", "12m"] as const;

function rangeOf(r: string) {
  const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (r === "last") return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
  if (r === "3m") return { from: new Date(Date.UTC(y, m - 2, 1)), to: new Date(Date.UTC(y, m + 1, 1)) };
  if (r === "12m") return { from: new Date(Date.UTC(y, m - 11, 1)), to: new Date(Date.UTC(y, m + 1, 1)) };
  return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)) };
}

export default async function ShopReports({ searchParams }: { searchParams: Promise<{ range?: string; month?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.reports.view", "buyer.branches.manage"]);
  const sp = await searchParams;
  const range = (RANGES as readonly string[]).includes(sp.range ?? "") ? sp.range! : "month";
  const [t, locale] = await Promise.all([getTranslations("multisite"), getLocale()]);
  const { from, to } = rangeOf(range);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? new Date(`${sp.month}-01T00:00:00Z`) : new Date();
  const monthKey = month.toISOString().slice(0, 7);
  const canInvoices = ctx.permissions.has("buyer.invoices.view") || ctx.permissions.has("buyer.branches.manage");
  const [cmp, prices, inv] = await Promise.all([branchComparison(ctx, from, to, locale), priceComparison(ctx, from, to, locale), canInvoices ? invoiceSummary(ctx, month) : Promise.resolve(null)]);
  const money = (v: string | number) => formatMoney(v, locale);
  const name = (r: { name: string | null }) => r.name ?? t("noShop");
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1)); return d.toISOString().slice(0, 7); });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <PageHeader title={t("reportsTitle")} description={t("reportsIntro")} icon={BarChart3} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("period")}>
        {RANGES.map((r) => <Link key={r} href={`?range=${r}&month=${monthKey}`} className={`rounded-full border px-3 py-1 text-sm ${r === range ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`} aria-current={r === range ? "page" : undefined}>{t(`range.${r}`)}</Link>)}
      </nav>
      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard className="xl:col-span-1" title={t("spendByShop")} description={t("totalSpend", { amount: money(cmp.total), orders: cmp.orders })}
          table={{ head: [t("shop"), t("spend")], rows: cmp.rows.map((r) => [name(r), money(r.spend)]), align: ["left", "right"] }} labels={{ chart: t("chart"), table: t("table") }}>
          <BarList rows={cmp.rows.map((r) => ({ key: r.id ?? "none", label: name(r), value: Number(r.spend), href: r.id ? `/buy/branches/${r.id}` : undefined }))} fmt="money" locale={locale} testId="spend-bars" emptyText={t("noOrders")} />
        </ChartCard>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>{t("compareShops")}</CardTitle><CardDescription>{t("compareShopsHint")}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="shop-comparison">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("shop")}</th><th className="py-1 pr-3 text-right font-medium">{t("orders")}</th><th className="py-1 pr-3 text-right font-medium">{t("spend")}</th><th className="py-1 pr-3 text-right font-medium">{t("avgOrder")}</th><th className="py-1 pr-3 font-medium">{t("budget")}</th><th className="py-1 text-right font-medium">{t("pendingApprovals")}</th></tr></thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.id ?? "none"} className="border-t align-top">
                    <td className="py-2 pr-3">{r.id ? <Link href={`/buy/branches/${r.id}`} className="font-medium hover:underline">{name(r)}</Link> : <span className="text-muted-foreground">{name(r)}</span>}{r.costCentre && <span className="block text-xs text-muted-foreground">{r.costCentre}</span>}{r.top.length > 0 && <span className="block text-xs text-muted-foreground">{t("top")}: {r.top.map((p) => p.name).join(", ")}</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.orders}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.spend)}<span className="block text-xs text-muted-foreground">{r.share}%</span></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(r.avgOrder)}</td>
                    <td className="w-40 py-2 pr-3">{r.budget ? <><BudgetBar pct={r.budget.pct} label={`${r.budget.name}: ${r.budget.pct}%`} /><span className="text-xs text-muted-foreground"><Badge variant={pctTone(r.budget.pct)}>{r.budget.pct}%</Badge> {money(r.budget.spent)} / {money(r.budget.amount)}</span></> : <span className="text-xs text-muted-foreground">—</span>}</td>
                    <td className="py-2 text-right tabular-nums">{r.pendingApprovals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-1 mt-8 text-lg font-semibold">{t("priceTitle")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("priceIntro")}</p>
      <DataTable tableId="buy.shop.prices" testId="price-comparison" empty={t("noPriceDiff")}
        columns={[{ key: "product", label: t("product") }, { key: "prices", label: t("pricePerShop") }, { key: "min", label: t("lowest"), type: "money" }, { key: "max", label: t("highest"), type: "money" }, { key: "spread", label: t("difference"), type: "number" }]}
        rows={prices.map((p) => ({
          id: p.offerId,
          cells: {
            product: { t: p.product, sub: [p.packaging, p.sku].filter(Boolean).join(" · ") }, prices: p.prices.map((x) => `${x.branch}: ${money(x.avgUnitNet)}`).join(" · "),
            min: { t: money(p.min), v: Number(p.min) }, max: { t: money(p.max), v: Number(p.max) }, spread: { t: `${p.spreadPct}%`, v: p.spreadPct, tone: p.spreadPct >= 5 ? "warning" : "outline" },
          },
        }))} />
      {inv && (
        <Card className="mt-8">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div><CardTitle>{t("invoicesTitle")}</CardTitle><CardDescription>{t("invoicesIntro")}</CardDescription></div>
            <div className="flex flex-wrap items-center gap-2">
              <form className="flex items-center gap-2" method="get"><input type="hidden" name="range" value={range} />
                <select name="month" defaultValue={monthKey} aria-label={t("month")} className="h-9 rounded-md border bg-card px-2 text-sm">{months.map((m) => <option key={m} value={m}>{monthFmt.format(new Date(`${m}-01T00:00:00Z`))}</option>)}</select>
                <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-accent">{t("show")}</button>
              </form>
              <a href={`/api/buy/branches/invoices?month=${monthKey}`} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent" data-testid="invoices-csv"><Download className="size-4" />CSV</a>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="invoice-summary">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("shop")}</th><th className="py-1 pr-3 font-medium">{t("costCentre")}</th><th className="py-1 pr-3 text-right font-medium">{t("documents")}</th><th className="py-1 pr-3 text-right font-medium">{t("net")}</th><th className="py-1 pr-3 text-right font-medium">{t("vat")}</th><th className="py-1 text-right font-medium">{t("total")}</th></tr></thead>
              <tbody>
                {inv.groups.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">{t("noInvoices")}</td></tr>}
                {inv.groups.map((g) => (
                  <tr key={`${g.branchId}-${g.costCentre}`} className="border-t"><td className="py-2 pr-3">{g.branch ?? t("noShop")}</td><td className="py-2 pr-3">{g.costCentre ?? "—"}</td><td className="py-2 pr-3 text-right tabular-nums">{g.count}</td><td className="py-2 pr-3 text-right tabular-nums">{money(g.net)}</td><td className="py-2 pr-3 text-right tabular-nums">{money(g.vat)}</td><td className="py-2 text-right font-medium tabular-nums">{money(g.gross)}</td></tr>
                ))}
                {inv.groups.length > 0 && <tr className="border-t-2 font-semibold"><td className="py-2 pr-3" colSpan={2}>{t("total")}</td><td className="py-2 pr-3 text-right tabular-nums">{inv.total.count}</td><td className="py-2 pr-3 text-right tabular-nums">{money(inv.total.net)}</td><td className="py-2 pr-3 text-right tabular-nums">{money(inv.total.vat)}</td><td className="py-2 text-right tabular-nums">{money(inv.total.gross)}</td></tr>}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">{t("invoicesNote")}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
