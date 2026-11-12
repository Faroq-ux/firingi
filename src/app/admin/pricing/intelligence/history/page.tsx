import { History } from "lucide-react";
import { notFound } from "next/navigation";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { priceComparison, productHistory, recentChanges } from "@/server/price-intel/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { PriceTimeline } from "@/components/price-intel/timeline";
import { AskSupplier, ProductPicker } from "@/components/price-intel/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Price History" };

export default async function PriceHistoryPage({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const { variant } = await searchParams;
  const options = (await priceComparison(ctx)).map((r) => ({ id: r.variantId, label: `${r.product} (${r.sku}) — ${r.stats.n} suppliers` }));
  const unique = [...new Map(options.map((o) => [o.id, o])).values()];
  if (!variant) {
    const changes = await recentChanges(ctx, 90);
    return (
      <>
        <PageHeader title="Price History" icon={History} description="Pick a product to see every supplier's price over the last six months, or browse all price changes of the last 90 days." />
        <div className="mb-6 flex flex-wrap items-end gap-3"><ProductPicker options={unique} value={null} /></div>
        <DataTable tableId="admin.price.history-all" testId="history-all" empty="No price changes in the last 90 days."
          columns={[{ key: "at", label: "When", type: "date" }, { key: "product", label: "Product" }, { key: "vendor", label: "Supplier", filter: true }, { key: "list", label: "Price list", type: "badge", filter: true }, { key: "old", label: "Old", type: "money" }, { key: "new", label: "New", type: "money" }, { key: "pct", label: "Change", type: "number" }]}
          rows={changes.map((c) => ({ id: c.id, href: `/admin/pricing/intelligence/history?variant=${c.variantId}`, cells: {
            at: { t: formatDate(c.at, "en", true), v: c.at.getTime() }, product: { t: c.product, sub: c.packaging }, vendor: c.vendor, list: { t: c.scope === "BASE" ? "base" : c.scope.toLowerCase().replace("_", " "), tone: "outline" },
            old: { t: c.old === null ? "—" : formatMoney(c.old, "en"), v: c.old ?? 0 }, new: { t: c.new === null ? "removed" : formatMoney(c.new, "en"), v: c.new ?? 0 }, pct: { t: c.pct === null ? "—" : `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)} %`, v: c.pct ?? 0 },
          } }))} />
      </>
    );
  }
  const h = await productHistory(ctx, variant).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const changes = h.series.flatMap((s) => s.changes.map((c, i) => ({ ...c, id: `${s.offerId}-${i}`, vendor: s.vendor, offerId: s.offerId }))).sort((a, b) => b.at.getTime() - a.at.getTime());
  return (
    <>
      <PageHeader title={`Price History — ${h.product}`} icon={History} description={`${h.sku} · base price per unit since ${formatDate(h.from, "en")}, one line per supplier offer.`} />
      <div className="mb-6 flex flex-wrap items-end gap-3"><ProductPicker options={unique} value={variant} /></div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Price per unit, last 6 months</CardTitle><CardDescription>Prices stay level until they change; dots mark changes. Hover for every supplier&apos;s price on a day.{h.series.length > 8 ? " Showing the first 8 suppliers — all are in the table." : ""}</CardDescription></CardHeader>
        <CardContent><PriceTimeline series={h.series.map((s) => ({ key: s.offerId, label: s.vendor, points: s.points }))} from={h.from.getTime()} to={h.now.getTime()} locale="en" label={`Price history of ${h.product}`} testId="price-timeline" /></CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader><CardTitle>Suppliers now</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="suppliers-now">
              {h.series.map((s) => { const last = s.points[s.points.length - 1]?.v; return (
                <li key={s.offerId} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">{s.flag} {s.vendor}{!s.active && <span className="text-xs text-muted-foreground"> (inactive)</span>}</span>
                  <span className="tabular-nums">{last == null ? "—" : formatMoney(last.toFixed(last < 1 ? 4 : 2), "en")}</span>
                  <AskSupplier offerId={s.offerId} />
                </li>
              ); })}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Changes (table view)</CardTitle></CardHeader>
          <CardContent>
            <DataTable tableId="admin.price.history" testId="history-changes" empty="No changes in this period."
              columns={[{ key: "at", label: "When", type: "date" }, { key: "vendor", label: "Supplier", filter: true }, { key: "old", label: "Old (pack)", type: "money" }, { key: "new", label: "New (pack)", type: "money" }, { key: "pct", label: "Change", type: "number" }]}
              rows={changes.map((c) => ({ id: c.id, cells: {
                at: { t: formatDate(c.at, "en", true), v: c.at.getTime() }, vendor: c.vendor, old: { t: c.old === null ? "—" : formatMoney(c.old, "en"), v: c.old ?? 0 }, new: { t: c.new === null ? "removed" : formatMoney(c.new, "en"), v: c.new ?? 0 },
                pct: { t: c.pct === null ? "new" : `${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)} %`, v: c.pct ?? 0, tone: c.pct === null ? undefined : c.pct > 0 ? "warning" : "success" },
              } }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
