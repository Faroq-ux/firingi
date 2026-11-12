import { Gauge } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminAccuracy } from "@/server/planning/service";
import { rowLabel } from "@/server/planning/engine";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { AccuracyChart } from "@/components/planning/forecast-chart";

export const metadata = { title: "Forecast Accuracy" };
const pct = (v: number | null) => (v === null ? { t: "—", v: -999 } : { t: `${v} %`, v });

export default async function Accuracy() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const d = await adminAccuracy(ctx);
  return (
    <>
      <PageHeader title="Forecast Accuracy" icon={Gauge} description={`Last 12 finished weeks. Accuracy = 1 − WAPE (Σ|actual − forecast| ÷ Σ actual); bias above 0 = forecasts too high (more stock than needed), below 0 = too low (risk of running out). ${d.total} product-weeks, ${d.backtested} of them back-tested (series planned for the first time).`} />
      <div className="mb-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>All suppliers — {d.overall.accuracyPct ?? "—"} % accurate, bias {d.overall.biasPct ?? "—"} %</CardTitle><CardDescription>Units per week.</CardDescription></CardHeader>
          <CardContent>{d.weeks.length ? <AccuracyChart weeks={d.weeks} locale="en" testId="accuracy-chart" labels={{ forecast: "Forecast", actual: "Actual sales", units: "units" }} /> : <p className="text-sm text-muted-foreground">No finished weeks yet.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>By supplier</CardTitle></CardHeader>
          <CardContent>
            <DataTable tableId="admin.planning.accuracy.suppliers" testId="accuracy-suppliers" empty="No suppliers."
              columns={[{ key: "name", label: "Supplier" }, { key: "acc", label: "Accuracy", type: "number" }, { key: "bias", label: "Bias", type: "number" }, { key: "weeks", label: "Product-weeks", type: "number" }]}
              rows={d.suppliers.map((s) => ({ id: s.id, cells: { name: { t: s.name, sub: s.inHouse ? "FIRINGI in-house" : undefined }, acc: pct(s.accuracyPct), bias: pct(s.biasPct), weeks: s.weeks } }))} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Hardest to forecast</CardTitle><CardDescription>Largest relative error first — usually new, irregular or promoted products. A demand event or a planning note helps the supplier.</CardDescription></CardHeader>
        <CardContent>
          <DataTable tableId="admin.planning.accuracy.worst" testId="accuracy-worst" empty="Nothing to show yet."
            columns={[{ key: "product", label: "Product" }, { key: "supplier", label: "Supplier", filter: true }, { key: "wh", label: "Warehouse" }, { key: "acc", label: "Accuracy", type: "number" }, { key: "bias", label: "Bias", type: "number" }, { key: "weeks", label: "Weeks", type: "number" }]}
            rows={d.worst.map((w) => ({ id: w.key, cells: { product: w.product ? rowLabel(w.product, "en") : "—", supplier: w.supplier, wh: w.warehouse, acc: pct(w.accuracyPct), bias: pct(w.biasPct), weeks: w.weeks } }))} />
        </CardContent>
      </Card>
    </>
  );
}
