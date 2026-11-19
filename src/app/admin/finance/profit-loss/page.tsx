import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { COST_CATEGORIES, listCosts, profitAndLoss } from "@/server/services/profit";
import { crmCountries } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { ChartCard, TimeChart } from "@/components/analytics/charts";
import { CostForm, DeleteCost } from "@/components/profit/forms";
import { COST_LABELS } from "@/lib/cost-labels";
import { Pills } from "@/components/crm/views";
import { CurrencySwitch } from "@/components/currency/switch";
import { currencySettings, reportFx } from "@/server/currency/service";
import { fmtValue, type Fmt } from "@/lib/analytics-format";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Profit & Loss" };
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);

export default async function Page({ searchParams }: { searchParams: Promise<{ months?: string; ccy?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const sp = await searchParams;
  const months = [3, 6, 12, 24].includes(Number(sp.months)) ? Number(sp.months) : 12;
  const countries = await crmCountries();
  const [{ rows, total }, costs, fx, cs] = await Promise.all([profitAndLoss(ctx, { months }), listCosts(ctx), reportFx(sp.ccy), currencySettings()]);
  // Phase 45: the books are in EUR; the switch shows them in another currency at today's reference rate
  const k = Number(fx.rate);
  const money: Fmt = fx.code === "EUR" ? "money" : `money:${fx.code}`;
  const eur = (n: number | { toString(): string }) => fmtValue(Number(n.toString()) * k, money, "pt-PT");
  const label = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const line = (name: string, get: (r: (typeof rows)[number]) => number, opts: { strong?: boolean; minus?: boolean; plus?: boolean; tone?: string } = {}) => (
    <TR className={opts.strong ? "bg-[color-mix(in_oklch,var(--vivid-blue)_6%,transparent)] font-semibold" : ""}>
      <TD className={opts.tone}>{opts.minus ? "− " : opts.plus ? "+ " : ""}{name}</TD>
      {rows.map((r) => <TD key={r.month} className={`text-right tabular-nums ${opts.tone ?? ""}`}>{eur(get(r))}</TD>)}
      <TD className={`text-right font-semibold tabular-nums ${opts.tone ?? ""}`}>{eur(rows.reduce((a, r) => a + get(r), 0))}</TD>
    </TR>
  );
  return (
    <>
      <PageHeader title="Profit & Loss" description="By invoice date. FIRINGI sells to the customer and buys from the supplier at the supplier price; delivery fees of FIRINGI's fleet are FIRINGI's, suppliers' flat rates are passed on. Net profit is after driver pay, price differences FIRINGI absorbed when moving orders, and the costs recorded below." />
      <div className="mb-3"><Pills items={[3, 6, 12, 24].map((m) => ({ value: String(m), label: `${m} months` }))} current={String(months)} param="months" base={{}} /></div>
      {cs.reportSwitch && <CurrencySwitch current={fx.code} params={{ months: String(months) }} note={fx.code !== "EUR" ? "at today's reference rate — the books are in EUR" : null} />}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="pnl-kpis">
        <Kpi label="Revenue" value={(total.revenue) * k} fmt={money} locale="pt-PT" tone="tone-blue" index={0} hint={`${total.orders} invoiced orders`} />
        <Kpi label="Gross profit" value={(total.gross) * k} fmt={money} locale="pt-PT" tone="tone-teal" index={1} hint={`margin ${pct(total.marginPct)}`} />
        <Kpi label="Operating costs" value={(total.driverPay + total.absorbed + total.costTotal) * k} fmt={money} locale="pt-PT" tone="tone-orange" index={2} />
        <Kpi label="Net profit" value={(total.net) * k} fmt={money} locale="pt-PT" tone={total.net >= 0 ? "tone-lime" : "tone-pink"} index={3} />
        <Kpi label="Commission earned" value={(total.commission) * k} fmt={money} locale="pt-PT" tone="tone-violet" index={4} />
      </div>
      <ChartCard title="Revenue, gross and net profit per month" className="mb-4"
        table={{ head: ["Month", "Revenue", "Gross", "Net"], rows: rows.map((r) => [label(r.month), eur(r.revenue), eur(r.gross), eur(r.net)]), align: ["left", "right", "right", "right"] }}>
        <TimeChart points={rows.map((r) => `${r.month}-01`)} grain="month" kind="bar" fmt={money} locale="pt-PT" testId="pnl-chart"
          series={[{ key: "revenue", label: "Revenue", values: rows.map((r) => r.revenue * k) }, { key: "gross", label: "Gross profit", values: rows.map((r) => r.gross * k) }, { key: "net", label: "Net profit", values: rows.map((r) => r.net * k) }]} />
      </ChartCard>
      <Card className="mb-4">
        <CardHeader><CardTitle>Statement</CardTitle></CardHeader>
        <CardContent>
          <Table data-testid="pnl-table">
            <THead><TR><TH>€, excl. VAT</TH>{rows.map((r) => <TH key={r.month} className="text-right">{label(r.month)}</TH>)}<TH className="text-right">Total</TH></TR></THead>
            <TBody>
              {line("Sales of goods", (r) => r.goods)}
              {line("Delivery fees (FIRINGI fleet)", (r) => r.firingiFees)}
              {line("Supplier delivery fees (passed on)", (r) => r.supplierFees)}
              {line("Revenue", (r) => r.revenue, { strong: true })}
              {line("Cost of goods & supplier fees", (r) => r.cogs, { minus: true })}
              {line("Credit notes to customers", (r) => r.credits, { minus: true })}
              {line("Supplier credit statements", (r) => r.vendorCredits, { plus: true })}
              {line("Gross profit", (r) => r.gross, { strong: true, tone: "text-[color:color-mix(in_oklch,var(--vivid-teal)_80%,var(--foreground))]" })}
              {line("Driver pay (FIRINGI routes)", (r) => r.driverPay, { minus: true })}
              {line("Price differences absorbed", (r) => r.absorbed, { minus: true })}
              {(total.fx !== 0 || total.fxMargin !== 0) && line("Exchange gains / losses (realised)", (r) => r.fx, { plus: true })}
              {total.fxMargin !== 0 && <TR><TD className="pl-6 text-xs text-muted-foreground">FX margin on invoices in other currencies (realised with the payment)</TD>{rows.map((r) => <TD key={r.month} className="text-right text-xs tabular-nums text-muted-foreground">{eur(r.fxMargin)}</TD>)}<TD className="text-right text-xs tabular-nums text-muted-foreground">{eur(total.fxMargin)}</TD></TR>}
              {COST_CATEGORIES.filter((c) => total.costs[c]).map((c) => <TR key={c}><TD>− {COST_LABELS[c]}</TD>{rows.map((r) => <TD key={r.month} className="text-right tabular-nums">{eur(r.costs[c] ?? 0)}</TD>)}<TD className="text-right font-semibold tabular-nums">{eur(total.costs[c])}</TD></TR>)}
              {line("Net profit", (r) => r.net, { strong: true, tone: total.net >= 0 ? "text-success" : "text-destructive" })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Costs</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {can(ctx, "admin.finance.manage") && <CostForm countries={countries} />}
          <Table data-testid="costs-table">
            <THead><TR><TH>Date</TH><TH>Category</TH><TH>Description</TH><TH className="text-right">Net</TH><TH className="text-right">VAT</TH><TH>Repeats</TH><TH>Paid</TH><TH /></TR></THead>
            <TBody>
              {costs.map((c) => (
                <TR key={c.id}>
                  <TD>{formatDate(c.date, "en-GB")}</TD><TD>{COST_LABELS[c.category]}</TD><TD>{c.description}</TD>
                  <TD className="text-right tabular-nums">{eur(c.amountNet)}</TD><TD className="text-right tabular-nums">{eur(c.vatAmount)}</TD>
                  <TD>{c.monthly ? `monthly${c.endDate ? ` until ${formatDate(c.endDate, "en-GB")}` : ""}` : "—"}</TD><TD>{c.paid ? "✓" : "—"}</TD>
                  <TD>{can(ctx, "admin.finance.manage") && <DeleteCost id={c.id} />}</TD>
                </TR>
              ))}
              {!costs.length && <EmptyRow colSpan={8}>No costs recorded yet.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
