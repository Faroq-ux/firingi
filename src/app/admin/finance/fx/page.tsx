import { Scale } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { fxReport } from "@/server/currency/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Exchange Gains & Losses" };
export const dynamic = "force-dynamic";

export default async function FxPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const r = await fxReport(ctx, { months: 12 });
  const eur = (v: number | string) => formatMoney(v, "pt-PT");
  const marginTotal = r.margin.reduce((a, m) => a + m.margin, 0);
  const unrealised = r.exposure.reduce((a, x) => a + x.unrealised, 0);
  return (
    <>
      <PageHeader title="Exchange Gains & Losses" icon={Scale} description="Last 12 months, in EUR. Realised = money in another currency settled a document booked at another rate (the FX margin is earned this way). Unrealised = what customers still owe in other currencies, valued at today's reference rate. Also in the P&L and the accounting export (accounts 7861 / 6863)." />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Kpi label="Realised gains / losses" value={r.total} fmt="money" locale="pt-PT" tone={r.total >= 0 ? "tone-lime" : "tone-pink"} testId="fx-total" />
        <Kpi label="FX margin on invoices" value={marginTotal} fmt="money" locale="pt-PT" tone="tone-violet" hint="at the reference rate, issued in the period" />
        <Kpi label="Unrealised on open invoices" value={unrealised} fmt="money" locale="pt-PT" tone={unrealised >= 0 ? "tone-teal" : "tone-orange"} hint="if paid at today's rate" />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>By currency</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <Table>
            <THead><TR><TH>Currency</TH><TH>Side</TH><TH className="text-right">Settled</TH><TH className="text-right">Gain / loss</TH></TR></THead>
            <TBody>
              {r.byCurrency.length === 0 && <EmptyRow colSpan={4}>Nothing settled in another currency yet.</EmptyRow>}
              {r.byCurrency.map((b) => <TR key={`${b.code}-${b.kind}`}><TD className="font-medium">{b.code}</TD><TD><Badge variant="secondary">{b.kind === "RECEIVABLE" ? "customers" : "suppliers"}</Badge></TD><TD className="text-right tabular-nums">{formatMoney(b.local, "pt-PT", b.code)}</TD><TD className={`text-right tabular-nums ${b.gainLoss < 0 ? "text-destructive" : ""}`}>{eur(b.gainLoss)}</TD></TR>)}
            </TBody>
          </Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Invoices in other currencies</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <Table>
            <THead><TR><TH>Currency</TH><TH className="text-right">Invoices</TH><TH className="text-right">Invoiced</TH><TH className="text-right">FX margin</TH><TH className="text-right">Open (today)</TH></TR></THead>
            <TBody>
              {r.margin.length === 0 && <EmptyRow colSpan={5}>No invoices in other currencies yet.</EmptyRow>}
              {r.margin.map((m) => {
                const x = r.exposure.find((e) => e.code === m.code);
                return <TR key={m.code}><TD className="font-medium">{m.code}</TD><TD className="text-right tabular-nums">{m.n}</TD><TD className="text-right tabular-nums">{formatMoney(m.local, "pt-PT", m.code)}<div className="text-xs text-muted-foreground">{eur(m.eur)}</div></TD><TD className="text-right tabular-nums">{eur(m.margin)}</TD><TD className="text-right tabular-nums">{x ? <>{eur(x.atToday)}<div className={`text-xs ${x.unrealised < 0 ? "text-destructive" : "text-muted-foreground"}`}>{x.unrealised >= 0 ? "+" : ""}{eur(x.unrealised)}</div></> : "—"}</TD></TR>;
              })}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Entries</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="fx-entries">
          <THead><TR><TH>Date</TH><TH>Company</TH><TH>Side</TH><TH className="text-right">Amount</TH><TH className="text-right">Document rate</TH><TH className="text-right">Rate on the day</TH><TH className="text-right">Gain / loss</TH></TR></THead>
          <TBody>
            {r.entries.length === 0 && <EmptyRow colSpan={7}>No entries yet.</EmptyRow>}
            {r.entries.map((e) => (
              <TR key={e.id}>
                <TD className="whitespace-nowrap text-xs">{formatDate(e.date, "en-GB")}</TD><TD>{e.company}</TD>
                <TD><Badge variant="secondary">{e.kind === "RECEIVABLE" ? "customer" : "supplier"}</Badge></TD>
                <TD className="text-right tabular-nums">{formatMoney(e.amountLocal.toString(), "pt-PT", e.currencyCode)}</TD>
                <TD className="text-right font-mono text-xs tabular-nums">{Number(e.docRate).toFixed(4)}</TD>
                <TD className="text-right font-mono text-xs tabular-nums">{Number(e.settleRate).toFixed(4)}</TD>
                <TD className={`text-right tabular-nums ${Number(e.gainLossEur) < 0 ? "text-destructive" : ""}`}>{eur(e.gainLossEur.toString())}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
