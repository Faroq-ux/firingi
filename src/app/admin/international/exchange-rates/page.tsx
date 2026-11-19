import { ArrowLeftRight } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { rateOverview } from "@/server/currency/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { RateSpark } from "@/components/currency/switch";
import { ClearOverrideButton, FetchRatesButton, RateOverrideForm } from "@/components/currency/admin";
import { LOCAL_CURRENCIES } from "@/lib/currency";

export const metadata = { title: "Exchange Rates" };
export const dynamic = "force-dynamic";

const fmt = (v: string | number | null, dp = 4) => (v == null ? "—" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp }));

export default async function ExchangeRatesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage"]);
  const o = await rateOverview();
  const manage = can(ctx, ["admin.settings.manage", "admin.international.manage"]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Exchange Rates" icon={ArrowLeftRight}
        description={`Units of each currency per €1. ${o.settings.feed === "ECB" ? "ECB daily reference rates" : "Rates typed in by FIRINGI"}; a rate set by hand wins for its day (the feed's value is kept beside it). Orders lock the rate in force when placed: customer rate = reference × (1 + FX margin).`}
        actions={manage && o.settings.feed === "ECB" ? <FetchRatesButton /> : undefined} />
      <Card className="mb-4">
        <CardHeader><CardTitle>Today</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table data-testid="rates-today">
            <THead><TR><TH>Currency</TH><TH className="text-right">Reference</TH><TH className="text-right">Change</TH><TH className="text-right">FX margin</TH><TH className="text-right">Customer rate</TH><TH>Date · source</TH><TH>45 days</TH></TR></THead>
            <TBody>
              {o.rows.map((r) => (
                <TR key={r.code} data-testid={`rate-${r.code}`}>
                  <TD className="font-medium">{r.code} {r.used && <Badge variant="success" className="ml-1">billing</Badge>}</TD>
                  <TD className="text-right font-mono tabular-nums">{fmt(r.rate)}</TD>
                  <TD className={`text-right tabular-nums ${r.change == null ? "" : Math.abs(r.change) >= o.settings.alertMovePct ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{r.change == null ? "—" : `${r.change > 0 ? "+" : ""}${r.change.toFixed(2)} %`}</TD>
                  <TD className="text-right tabular-nums">{r.margin ? `${r.margin} %` : "—"}</TD>
                  <TD className="text-right font-mono tabular-nums">{fmt(r.customerRate)}</TD>
                  <TD className="text-xs">
                    {r.date ?? "no rate"} · {r.source ?? "—"}
                    {r.source === "MANUAL" && <Badge variant="secondary" className="ml-1">by hand{r.feedRate ? ` (feed ${fmt(r.feedRate)})` : ""}</Badge>}
                    {r.stale && <Badge variant="destructive" className="ml-1" data-testid={`stale-${r.code}`}>stale</Badge>}
                  </TD>
                  <TD className="w-28">{r.history.length > 1 ? <RateSpark values={r.history.map((h) => h.rate)} label={`${r.code} last 45 days`} /> : <span className="text-xs text-muted-foreground">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      {manage && (
        <Card className="mb-4">
          <CardHeader><CardTitle>Set a rate by hand (today)</CardTitle></CardHeader>
          <CardContent><RateOverrideForm codes={LOCAL_CURRENCIES} /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead><TR><TH>Date</TH><TH>Currency</TH><TH className="text-right">Rate</TH><TH>Source</TH><TH>Note</TH><TH /></TR></THead>
            <TBody>
              {o.history.length === 0 && <EmptyRow colSpan={6}>No rates yet.</EmptyRow>}
              {o.history.slice(0, 120).map((h) => (
                <TR key={h.id}>
                  <TD className="text-xs">{h.date}</TD><TD className="font-medium">{h.code}</TD>
                  <TD className="text-right font-mono tabular-nums">{fmt(h.rate)}</TD>
                  <TD className="text-xs text-muted-foreground">{h.source}{h.feedRate ? ` · feed ${fmt(h.feedRate)}` : ""}</TD>
                  <TD className="text-xs">{h.note ?? ""}</TD>
                  <TD>{manage && h.source === "MANUAL" && h.date >= today && <ClearOverrideButton id={h.id} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
