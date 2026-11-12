import Link from "next/link";
import { AlertOctagon, Building2, Gauge, Hourglass, Layers, PackageX, TrendingUp } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview, canAdminManagePlanning } from "@/server/planning/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { AccuracyChart } from "@/components/planning/forecast-chart";
import { RunPlanningNow } from "@/components/planning/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Demand Planning" };
const B = "/admin/inventory/planning";
const METHOD = { AVERAGE: "average", HOLT: "trend", CROSTON: "intermittent", SEASONAL: "seasonal" } as Record<string, string>;

export default async function PlanningOverview() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const d = await adminOverview(ctx);
  const s = d.suppliers;
  const tot = (k: "out" | "late" | "orderNow" | "soon" | "expiryValue" | "overstockValue") => s.reduce((a, x) => a + x[k], 0);
  const acc = d.accuracy.overall;
  return (
    <>
      <PageHeader title="Demand Planning" icon={TrendingUp}
        description="Weekly demand forecasts for every supplier's products and warehouses, restock suggestions, supplier lead times, and stock at risk of running out, expiring or sitting too long. Suppliers decide on their own stock; FIRINGI decides for its in-house warehouse and can ask a supplier to restock."
        actions={canAdminManagePlanning(ctx) ? <RunPlanningNow /> : undefined} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile icon={PackageX} label="Out of stock" value={tot("out")} locale="en" tone="tone-pink" i={0} href={`${B}/stockouts`} testId="kpi-out" hint="still selling, nothing left" />
        <Tile icon={AlertOctagon} label="Need ordering now" value={tot("late") + tot("orderNow")} locale="en" tone="tone-orange" i={1} href={`${B}/stockouts`} hint={tot("late") ? `${tot("late")} run out before goods can arrive` : undefined} testId="kpi-order" />
        <Tile icon={Building2} label="Suppliers planned" value={s.length} locale="en" tone="tone-blue" i={2} hint={`${s.reduce((a, x) => a + x.products, 0)} product × warehouse series`} />
        <Tile icon={Gauge} label="Forecast accuracy" value={acc.accuracyPct === null ? undefined : acc.accuracyPct / 100} fmt="percent" locale="en" tone="tone-teal" i={3} href={`${B}/accuracy`} testId="kpi-accuracy" hint={acc.biasPct === null ? "no finished weeks yet" : `bias ${acc.biasPct > 0 ? "+" : ""}${acc.biasPct} % · ${d.accuracy.total} product-weeks`} />
        <Tile icon={Hourglass} label="Expiry risk (at cost)" value={tot("expiryValue")} fmt="money" locale="en" tone="tone-pink" i={4} href={`${B}/overstock`} />
        <Tile icon={Layers} label="Overstock (at cost)" value={tot("overstockValue")} fmt="money" locale="en" tone="tone-violet" i={5} href={`${B}/overstock`} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader><CardTitle>Forecast vs. actual</CardTitle><CardDescription>All suppliers, units per week. Forecasts are frozen when the week starts (back-tested for new series).</CardDescription></CardHeader>
          <CardContent>{d.accuracy.weeks.length ? <AccuracyChart weeks={d.accuracy.weeks} locale="en" testId="accuracy-chart" labels={{ forecast: "Forecast", actual: "Actual sales", units: "units" }} /> : <p className="text-sm text-muted-foreground">No finished weeks yet.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>How it works</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Every night at 04:37 each product × warehouse gets a weekly forecast. Several methods compete in a back-test of the last weeks — a plain average, a damped trend, Croston for products that sell in some weeks only, and same-week-last-year once there is a year of history — and the most accurate one wins. Holidays and promotions (<Link href={`${B}/events`} className="text-primary hover:underline">demand events</Link>) are taken out of the history and put back into the forecast.</p>
            <p>From the forecast, the supplier&apos;s service level and the supplier lead time (measured from received purchase orders once there are 3) come the safety stock, the reorder point and the order-up-to level. A suggestion appears when stock plus what is on order falls to the reorder point; a person turns it into a draft purchase order or dismisses it.</p>
            <p className="text-muted-foreground">{d.lastRun ? `Last run ${formatDate(d.lastRun.startedAt, "en", true)}${d.lastRun.ok === false ? " — failed" : ""}.` : "Not run by the scheduler yet."}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>By supplier</CardTitle></CardHeader>
        <CardContent>
          <DataTable tableId="admin.planning.suppliers" testId="planning-suppliers" empty="No stock-holding suppliers."
            columns={[
              { key: "name", label: "Supplier" }, { key: "type", label: "Type", type: "badge", filter: true }, { key: "products", label: "Series", type: "number" },
              { key: "out", label: "Out", type: "number" }, { key: "now", label: "Order now", type: "number" }, { key: "soon", label: "Soon", type: "number" },
              { key: "acc", label: "Accuracy", type: "number" }, { key: "exp", label: "Expiry risk", type: "money" }, { key: "over", label: "Overstock", type: "money" }, { key: "stock", label: "Stock value", type: "money" }, { key: "methods", label: "Methods" },
            ]}
            rows={s.map((x) => ({
              id: x.id, href: `${B}/stockouts?supplier=${x.id}`,
              cells: {
                name: x.name, type: { t: x.inHouse ? "FIRINGI in-house" : x.type.toLowerCase(), tone: x.inHouse ? "default" : "outline" }, products: x.products,
                out: { t: String(x.out), v: x.out, tone: x.out ? "destructive" : undefined }, now: { t: String(x.late + x.orderNow), v: x.late + x.orderNow, tone: x.late ? "destructive" : x.orderNow ? "warning" : undefined }, soon: x.soon,
                acc: x.accuracy?.accuracyPct == null ? { t: "—", v: -1 } : { t: `${x.accuracy.accuracyPct} %`, v: x.accuracy.accuracyPct },
                exp: { t: formatMoney(x.expiryValue, "en"), v: x.expiryValue }, over: { t: formatMoney(x.overstockValue, "en"), v: x.overstockValue }, stock: { t: formatMoney(x.stockValue, "en"), v: x.stockValue },
                methods: Object.entries(x.methods).map(([m, c]) => `${METHOD[m] ?? m} ${c}`).join(" · ") || "—",
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
