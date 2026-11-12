import Link from "next/link";
import { Grid3x3 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { marginHeatmap, type HeatBy } from "@/server/price-intel/insights";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Margin Heat-map" };
const BY: Record<HeatBy, string> = { SUPPLIER: "Supplier", BUSINESS_TYPE: "Customer type", COUNTRY: "Customer country" };
const PERIODS = { "30": "30 days", "90": "90 days", "365": "12 months" } as const;

export default async function MarginHeatmap({ searchParams }: { searchParams: Promise<{ by?: string; days?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.finance.view"]);
  const sp = await searchParams;
  const by = (["SUPPLIER", "BUSINESS_TYPE", "COUNTRY"].includes(sp.by ?? "") ? sp.by : "SUPPLIER") as HeatBy;
  const days = (sp.days && sp.days in PERIODS ? sp.days : "90") as keyof typeof PERIODS;
  const to = new Date(), from = new Date(Date.now() - Number(days) * 86_400_000);
  const d = await marginHeatmap(ctx, { from, to, by });
  const maxPct = Math.max(1, ...d.rows.flatMap((r) => r.cells.map((c) => (c.sales > 0 ? c.pct : 0))));
  // sequential, one hue: light (low margin) → dark (high margin); empty cells stay neutral
  // negative margin (FIRINGI loses money) is a problem, not a low value: status colour + sign, never just a pale cell
  const bg = (c: { sales: number; pct: number }) => (c.sales <= 0 || c.pct < 0 ? undefined : `color-mix(in srgb, var(--series-1) ${Math.round(8 + (c.pct / maxPct) * 52)}%, var(--card))`);
  const ink = (c: { sales: number; pct: number }) => (c.sales > 0 && c.pct < 0 ? "bg-destructive/12 font-semibold text-destructive ring-1 ring-destructive/40" : "text-foreground");
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary"}`;
  return (
    <>
      <PageHeader title="Margin Heat-map" icon={Grid3x3} description="FIRINGI's margin = what customers paid (net) − what FIRINGI pays the supplier, per top category. Darker = higher margin %. Hover a cell for sales and margin in euros." />
      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="heat-filters">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</span>
        {(Object.keys(BY) as HeatBy[]).map((k) => <Link key={k} href={`?by=${k}&days=${days}`} className={chip(by === k)}>{BY[k]}</Link>)}
        <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Period</span>
        {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((k) => <Link key={k} href={`?by=${by}&days=${k}`} className={chip(days === k)}>{PERIODS[k]}</Link>)}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Margin % by category × {BY[by].toLowerCase()}</CardTitle>
          <CardDescription>Total: {formatMoney(d.total.sales, "en")} sales, {formatMoney(d.total.margin, "en")} margin ({d.total.pct.toFixed(1)} %). Top 10 columns by sales.</CardDescription>
        </CardHeader>
        <CardContent>
          {d.rows.length === 0 ? <p className="text-sm text-muted-foreground">No orders in this period.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-separate border-spacing-0.5 text-sm" data-testid="heatmap">
                <thead>
                  <tr><th className="p-2 text-left text-xs font-semibold text-muted-foreground">Category</th>{d.cols.map((c) => <th key={c.id} className="max-w-28 truncate p-2 text-xs font-semibold text-muted-foreground" title={c.label}>{c.label}</th>)}<th className="p-2 text-xs font-semibold text-muted-foreground">All</th></tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <th className="whitespace-nowrap p-2 text-left font-medium">{r.label}</th>
                      {r.cells.map((c, i) => (
                        <td key={i} className={`rounded-md p-2 text-center tabular-nums ${ink(c)}`} style={{ background: bg(c) }} title={c.sales > 0 ? `${r.label} · ${d.cols[i].label}: ${formatMoney(c.sales, "en")} sales, ${formatMoney(c.margin, "en")} margin` : "no sales"}>
                          {c.sales > 0 ? `${c.pct < 0 ? "▼ " : ""}${c.pct.toFixed(1)} %` : <span className="text-muted-foreground">·</span>}
                        </td>
                      ))}
                      <td className="rounded-md bg-muted/60 p-2 text-center font-semibold tabular-nums" title={`${formatMoney(r.total.sales, "en")} sales, ${formatMoney(r.total.margin, "en")} margin`}>{r.total.sales > 0 ? `${r.total.pct.toFixed(1)} %` : "·"}</td>
                    </tr>
                  ))}
                  <tr>
                    <th className="p-2 text-left font-semibold">All</th>
                    {d.colTotals.map((c, i) => <td key={i} className="rounded-md bg-muted/60 p-2 text-center font-semibold tabular-nums" title={`${formatMoney(c.sales, "en")} sales`}>{c.sales > 0 ? `${c.pct.toFixed(1)} %` : "·"}</td>)}
                    <td className="rounded-md bg-muted p-2 text-center font-bold tabular-nums">{d.total.pct.toFixed(1)} %</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
                <span>0 %</span><span className="h-2 w-40 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--series-1) 8%, var(--card)), color-mix(in srgb, var(--series-1) 60%, var(--card)))" }} /><span>{maxPct.toFixed(0)} %</span><span className="ml-3 rounded px-1.5 py-0.5 font-semibold text-destructive ring-1 ring-destructive/40">▼ negative margin</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
