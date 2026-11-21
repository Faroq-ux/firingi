import Link from "next/link";
import { Download, Globe2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierPeriods, supplierReport } from "@/server/trade/service";
import { tradeSettings } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fill, tradeLabels } from "@/components/trade/labels";

export const metadata = { title: "EU Trade Report" };
export const dynamic = "force-dynamic";

const ECSL_COLS = ["country", "vat", "customer", "type", "value", "corrects"];
const INTRA_COLS = ["cn", "description", "destination", "origin", "nature", "transport", "terms", "partnerVat", "netKg", "supp", "suppUnitCol", "value", "statValue", "corrects"];

export default async function VendorEuTradePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.reports.view", "vendor.invoices.view", "vendor.orders.view"]);
  const { l, locale } = await tradeLabels();
  const s = await tradeSettings();
  if (!s.enabled || !s.returns.supplierReports) return (<><PageHeader title={l.reportTitle} icon={Globe2} description={l.reportIntro} /><p className="rounded-lg border bg-muted/40 p-3 text-sm">{l.reportOff}</p></>);
  const periods = await supplierPeriods(ctx);
  const sp = (await searchParams).period;
  const period = sp && /^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/.test(sp) ? sp : periods[0];
  const r = await supplierReport(ctx, period, locale);
  const money = (v: unknown) => Number(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const head = (k: string) => (k === "cn" ? l.cn : k === "origin" ? l.origin : k === "netKg" ? l.netKg : k === "supp" ? l.supp : k === "suppUnitCol" ? "" : l[`cols.${k}`] ?? k);
  const cell = (k: string, v: unknown) => (v == null || v === "" ? "" : k === "type" ? l[`types.${v}`] ?? String(v) : k === "value" || k === "statValue" ? money(v) : String(v));
  const dl = (kind: string, format: string) => `/api/trade/supplier?period=${period}&kind=${kind}&format=${format}`;
  const missing = r.intrastat.rows.some((row) => !row[0] || !row[8]);
  const table = (cols: string[], rows: (string | number | null)[][], testid: string) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" data-testid={testid}>
        <thead><tr className="text-left text-xs text-muted-foreground">{cols.map((c) => <th key={c} className="py-1 pr-2">{head(c)}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i} className="border-t">{row.map((v, j) => <td key={j} className="py-1.5 pr-2 tabular-nums">{cell(cols[j], v)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <>
      <PageHeader title={l.reportTitle} icon={Globe2} description={l.reportIntro} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="eu-periods">
        <span className="text-muted-foreground">{l.period}:</span>
        {periods.map((p) => <Link key={p} href={`?period=${p}`} className={`rounded-full border px-3 py-1 tabular-nums ${p === period ? "bg-primary text-primary-foreground" : ""}`}>{p}</Link>)}
      </div>
      {!r.lines.length ? <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground" data-testid="eu-empty">{l.empty}</p></CardContent></Card> : (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{l.ecslTitle}</CardTitle><CardDescription>{l.ecslHint} {fill(l.total, { amount: `${money(r.total)} €` })}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-sm"><a className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" href={dl("ECSL", "csv")}><Download className="size-4" /> {l.downloadCsv}</a><a className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" href={dl("ECSL", "xlsx")}><Download className="size-4" /> {l.downloadXlsx}</a></div>
              {table(ECSL_COLS, r.ecsl.rows, "eu-ecsl")}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{l.intrastatTitle}</CardTitle><CardDescription>{l.intrastatHint}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {missing && <p className="text-sm text-amber-700" data-testid="eu-missing"><Link className="underline" href="/vendor/products/customs">{l.missingData}</Link></p>}
              <div className="flex flex-wrap gap-2 text-sm"><a className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" href={dl("DISPATCHES", "csv")}><Download className="size-4" /> {l.downloadCsv}</a><a className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" href={dl("DISPATCHES", "xlsx")}><Download className="size-4" /> {l.downloadXlsx}</a></div>
              {table(INTRA_COLS, r.intrastat.rows, "eu-intrastat")}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
