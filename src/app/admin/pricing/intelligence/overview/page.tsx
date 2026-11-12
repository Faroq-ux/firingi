import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BellRing, ClipboardCheck, Gauge, LineChart, Scale } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canManagePricing, recentChanges } from "@/server/price-intel/service";
import { priceOverview } from "@/server/price-intel/insights";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { ChartCard, TimeChart } from "@/components/analytics/charts";
import { RunPricingCheck } from "@/components/price-intel/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Price Intelligence" };
const B = "/admin/pricing/intelligence";

export default async function PriceIntelligence() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const [d, changes] = await Promise.all([priceOverview(ctx), recentChanges(ctx, 30)]);
  const k = d.kpi;
  const movers = changes.filter((c) => c.scope === "BASE" && c.pct !== null).sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!)).slice(0, 12);
  return (
    <>
      <PageHeader title="Price Intelligence" icon={LineChart} description="Every supplier price change is recorded. Compare suppliers for the same product, catch jumps and prices far from the market, approve big increases before customers see them, and see where FIRINGI earns its margin." actions={canManagePricing(ctx) ? <RunPricingCheck /> : undefined} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={ArrowUpRight} label="Increases (30 days)" value={k.increases30} locale="en" tone="tone-orange" i={0} hint={`average change ${k.avgChange30 > 0 ? "+" : ""}${k.avgChange30} %`} />
        <Tile icon={ArrowDownRight} label="Decreases (30 days)" value={k.decreases30} locale="en" tone="tone-teal" i={1} />
        <Tile icon={ClipboardCheck} label="Increases to approve" value={k.pending} locale="en" tone="tone-violet" i={2} href={`${B}/requests`} hint={k.approved ? `${k.approved} approved, not yet applied` : undefined} testId="kpi-pending" />
        <Tile icon={BellRing} label="Open price alerts" value={k.openAlerts} locale="en" tone="tone-pink" i={3} href={`${B}/alerts`} testId="kpi-alerts" hint={[d.alertsByKind.JUMP ? `${d.alertsByKind.JUMP} jumps` : null, d.alertsByKind.ABOVE_MARKET ? `${d.alertsByKind.ABOVE_MARKET} above market` : null, d.alertsByKind.BELOW_MARKET ? `${d.alertsByKind.BELOW_MARKET} below` : null].filter(Boolean).join(" · ") || undefined} />
        <Tile icon={Scale} label="Products compared" value={k.markets} locale="en" tone="tone-blue" i={4} href={`${B}/comparison`} hint="sold by 2 or more suppliers" />
        <Tile icon={Gauge} label="Average spread" value={k.avgSpread} locale="en" tone="tone-lime" i={5} hint="cheapest → dearest supplier, %" />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <ChartCard title="Price changes per week" description="Last 12 weeks, all price lists. Increases and decreases on one axis (number of changes).">
          <TimeChart points={d.weekly.points} grain="week" series={d.weekly.series} fmt="number" locale="en" kind="bar" height={240} testId="weekly-changes" />
        </ChartCard>
        <Card>
          <CardHeader><CardTitle>Biggest moves (30 days)</CardTitle><CardDescription>Base prices. <Link href={`${B}/history`} className="text-primary hover:underline">All changes →</Link></CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="movers">
              {movers.length === 0 && <li className="py-2 text-muted-foreground">No base price changed in the last 30 days.</li>}
              {movers.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2">
                  <span className={`inline-flex w-16 shrink-0 justify-end font-semibold tabular-nums ${c.pct! > 0 ? "text-amber-700 dark:text-warning" : "text-success"}`}>{c.pct! > 0 ? "▲" : "▼"} {Math.abs(c.pct!).toFixed(1)} %</span>
                  <Link href={`${B}/history?variant=${c.variantId}`} className="min-w-0 flex-1 truncate text-primary hover:underline">{c.product} <span className="text-muted-foreground">· {c.packaging}</span></Link>
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">{c.vendor}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Latest price changes</CardTitle></CardHeader>
        <CardContent>
          <DataTable tableId="admin.price.recent" testId="recent-changes" empty="No price changes in the last 30 days."
            columns={[{ key: "at", label: "When", type: "date" }, { key: "product", label: "Product" }, { key: "vendor", label: "Supplier", filter: true }, { key: "list", label: "Price list", type: "badge", filter: true }, { key: "old", label: "Old", type: "money" }, { key: "new", label: "New", type: "money" }, { key: "pct", label: "Change", type: "number" }]}
            rows={changes.slice(0, 200).map((c) => ({
              id: c.id, href: `${B}/history?variant=${c.variantId}`,
              cells: {
                at: { t: formatDate(c.at, "en", true), v: c.at.getTime() }, product: { t: c.product, sub: `${c.packaging}${c.minQty > 1 ? ` · from ${c.minQty}` : ""}` }, vendor: c.vendor,
                list: { t: c.scope === "BASE" ? "base" : c.scope.toLowerCase().replace("_", " "), tone: c.scope === "BASE" ? "outline" : "default" },
                old: { t: c.old === null ? "—" : formatMoney(c.old, "en"), v: c.old ?? 0 }, new: { t: c.new === null ? "removed" : formatMoney(c.new, "en"), v: c.new ?? 0 },
                pct: { t: c.pct === null ? "—" : `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)} %`, v: c.pct ?? 0, tone: c.pct === null ? undefined : c.pct > 0 ? "warning" : "success" },
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
