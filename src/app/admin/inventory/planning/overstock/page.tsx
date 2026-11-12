import { Hourglass } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminStockRisk } from "@/server/planning/service";
import { rowLabel } from "@/server/planning/engine";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Overstock & Expiry Risk" };

export default async function Overstock() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const rows = await adminStockRisk(ctx);
  const action = (r: (typeof rows)[number]) => {
    const a = r.action;
    if (a.kind === "TRANSFER") return `Move ${a.qty} to ${a.to}`;
    if (a.kind === "MARKDOWN") return a.enabled ? `Discount ${a.pct} %` : `Discount ${a.pct} % (markdowns off for this supplier)`;
    if (a.kind === "WRITE_OFF") return "Write off (expired)";
    return "Stop buying until it sells";
  };
  return (
    <>
      <PageHeader title="Overstock & Expiry Risk" icon={Hourglass} description="Stock that won't sell before its best-before at the forecast pace (first-expiry-first-out), and stock beyond each supplier's overstock limit. The suggested action is the supplier's to take: move it to a warehouse that sells it, discount it close to the date (when FIRINGI allows markdowns for that supplier), or stop buying." />
      <Card>
        <CardContent className="pt-6">
          <DataTable tableId="admin.planning.overstock" testId="admin-overstock" empty="No stock at risk."
            columns={[
              { key: "kind", label: "Risk", type: "badge", filter: true }, { key: "supplier", label: "Supplier", filter: true }, { key: "product", label: "Product" }, { key: "wh", label: "Warehouse" },
              { key: "lot", label: "Lot / best before" }, { key: "units", label: "Units at risk", type: "number" }, { key: "value", label: "Value at cost", type: "money" }, { key: "action", label: "Suggested" },
            ]}
            rows={rows.map((r) => ({
              id: `${r.companyId}-${r.key}`,
              cells: {
                kind: r.kind === "EXPIRY" ? { t: r.batch?.expired ? "expired" : "expiry", tone: r.batch?.expired ? "destructive" : "warning" } : { t: "overstock", tone: "secondary" },
                supplier: { t: r.company, sub: r.inHouse ? "FIRINGI in-house" : undefined }, product: rowLabel(r, "en"), wh: r.warehouse,
                lot: r.batch ? { t: `${r.batch.lotCode ?? "—"} · ${formatDate(r.batch.expiresOn, "en")}`, v: r.batch.expiresOn.getTime(), sub: `${r.batch.daysLeft} days left` } : { t: r.noSales ? "no sales" : `${r.coverDays ?? "365+"} days of cover`, v: 0 },
                units: r.units, value: { t: formatMoney(r.value, "en"), v: r.value }, action: action(r),
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
