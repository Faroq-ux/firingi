import Link from "next/link";
import { Download, Globe2 } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { returnDetail } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReturnActions } from "@/components/trade/admin";
import { ProblemBadges, StatusBadge, eur, kg } from "@/components/trade/views";

export const metadata = { title: "EU Trade Return" };
export const dynamic = "force-dynamic";

const LAYOUT: Record<string, string> = { GENERIC: "Generic CSV", PT: "Portugal (AT / INE)", ES: "Spain (Modelo 349)", FR: "France (DEB / DES)", DE: "Germany (ZM / IDEV)" };

export default async function EuTradeReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.tax.manage", "admin.invoices.view"]);
  const { id } = await params;
  const r = await returnDetail(ctx, id);
  const manage = can(ctx, ["admin.tax.manage", "admin.finance.manage"]);
  const dl = (f: string) => `/api/trade/returns/${r.id}?format=${f}`;
  return (
    <>
      <PageHeader title={`${r.kindName} · ${r.period}`} icon={Globe2} description={`${r.entity} (${r.country}) — due ${r.dueOn}.`} />
      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="trade-return-head">
        <StatusBadge status={r.status} />
        {!r.obliged && <Badge variant="secondary">Under the Intrastat threshold — not required yet</Badge>}
        {r.problems > 0 && <Badge variant="destructive">{r.problems} line(s) with missing data</Badge>}
        {r.corrections > 0 && <Badge variant="warning">{r.corrections} correction line(s)</Badge>}
        <span className="text-sm text-muted-foreground">Total {eur(r.total)}{r.kind !== "ECSL" ? ` · ${kg(r.massKg)}` : ""} · {r.lines} lines{r.builtAt ? ` · rebuilt ${r.builtAt.slice(0, 16).replace("T", " ")}` : ""}</span>
      </div>
      {r.status === "FILED" && <p className="mb-4 text-sm" data-testid="trade-filed">Filed {r.filedAt?.slice(0, 10)} by {r.filedBy ?? "—"} · reference <span className="font-mono">{r.filingRef}</span>{r.note ? ` · ${r.note}` : ""}</p>}
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_minmax(0,420px)]">
        <Card>
          <CardHeader><CardTitle>As it will be filed</CardTitle><CardDescription>Grouped the way the return asks for it. Download the file for the {LAYOUT[r.format] ?? r.format} portal, or a spreadsheet for your accountant.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm" data-testid="trade-downloads">
              <a className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" href={dl("national")}><Download className="size-4" /> {LAYOUT[r.format] ?? r.format}</a>
              <a className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" href={dl("csv")}><Download className="size-4" /> CSV</a>
              <a className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5" href={dl("xlsx")}><Download className="size-4" /> Excel</a>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm" data-testid="trade-summary">
                <thead><tr className="text-left text-xs text-muted-foreground">{r.summary.headers.map((h) => <th key={h} className="py-1 pr-2">{h}</th>)}</tr></thead>
                <tbody>{r.summary.rows.map((row, i) => <tr key={i} className="border-t">{row.map((c, j) => <td key={j} className={`py-1.5 pr-2 ${typeof c === "number" ? "tabular-nums" : ""}`}>{c == null ? "" : String(c)}</td>)}</tr>)}</tbody>
              </table>
              {!r.summary.rows.length && <p className="text-sm text-muted-foreground">Nothing to report for this period (a nil return).</p>}
            </div>
          </CardContent>
        </Card>
        {manage && <Card><CardHeader><CardTitle>Filing</CardTitle><CardDescription>Upload the file at the authority&apos;s portal, then record the reference here.</CardDescription></CardHeader><CardContent><ReturnActions id={r.id} status={r.status as "OPEN"} problems={r.problems} canReopen={can(ctx, "admin.tax.manage")} /></CardContent></Card>}
      </div>
      <Card>
        <CardHeader><CardTitle>Lines</CardTitle><CardDescription>Each document line behind the return. Fix customs data in <Link className="underline" href="/admin/invoices/eu-trade/codes">Customs Codes</Link> and VAT numbers in <Link className="underline" href="/admin/invoices/eu-trade/vies">VIES checks</Link>, then rebuild.</CardDescription></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm" data-testid="trade-lines">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Document</th><th>Partner</th><th>VAT</th>{r.kind !== "ECSL" && <><th>CN8</th><th>Description</th><th>Origin</th><th className="text-right">Net mass</th></>}{r.kind === "ECSL" && <th>Type</th>}<th className="pr-3 text-right">Value</th><th className="pr-2">Corrects</th><th>Problems</th></tr></thead>
              <tbody>
                {r.items.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="py-1.5 pr-2"><span className="font-mono text-xs">{l.number}</span><span className="block text-xs text-muted-foreground">{l.date} · {l.source.toLowerCase().replace("_", " ")}</span></td>
                    <td className="pr-2">{l.partner}<span className="block text-xs text-muted-foreground">{l.country}</span></td>
                    <td className="font-mono text-xs">{l.vat ?? "—"}</td>
                    {r.kind !== "ECSL" && <><td className="font-mono text-xs">{l.cn ?? "—"}</td><td className="max-w-[260px] break-words pr-2">{l.description}</td><td>{l.origin ?? "—"}</td><td className="text-right tabular-nums">{kg(l.massKg)}</td></>}
                    {r.kind === "ECSL" && <td>{l.indicator === "SERVICES" ? "Services" : l.indicator === "TRIANGULAR" ? "Triangular" : "Goods"}</td>}
                    <td className="pr-3 text-right tabular-nums">{eur(l.value)}</td>
                    <td className="pr-2">{l.corrects ?? ""}</td>
                    <td><ProblemBadges problems={l.problems} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
