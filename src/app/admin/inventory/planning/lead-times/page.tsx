import { Timer } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminLeadTimes } from "@/server/planning/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";

export const metadata = { title: "Supplier Lead Times" };
const d = (v: number | null) => (v === null ? { t: "—", v: -1 } : { t: `${v} d`, v });

export default async function LeadTimes() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const rows = (await adminLeadTimes(ctx)).filter((r) => r.stats.orders > 0 || r.active);
  return (
    <>
      <PageHeader title="Supplier Lead Times" icon={Timer} description="How long the suppliers' own suppliers take, measured from purchase order sent to first goods received. Planning uses the measured time once there are 3 receipts (each supplier can switch back to its stated time). Distributors on FIRINGI are measured from the orders placed with them." />
      <Card>
        <CardContent className="pt-6">
          <DataTable tableId="admin.planning.lead" testId="admin-lead-times" empty="No purchase sources yet."
            columns={[
              { key: "company", label: "Buyer (supplier on FIRINGI)", filter: true }, { key: "source", label: "Buys from" }, { key: "kind", label: "Kind", type: "badge", filter: true },
              { key: "stated", label: "Stated", type: "number" }, { key: "measured", label: "Measured", type: "number" }, { key: "p90", label: "90 % within", type: "number" },
              { key: "ontime", label: "On time", type: "number" }, { key: "fill", label: "Filled", type: "number" }, { key: "orders", label: "Receipts", type: "number" }, { key: "used", label: "Planned with", type: "number" },
            ]}
            rows={rows.map((r) => ({
              id: `${r.companyId}-${r.key}`,
              cells: {
                company: { t: r.company, sub: r.inHouse ? "FIRINGI in-house" : undefined }, source: r.name, kind: { t: r.kind === "OUTSIDE" ? "outside" : "on FIRINGI", tone: r.kind === "OUTSIDE" ? "outline" : "default" },
                stated: d(r.stated), measured: { ...d(r.stats.measured), tone: r.stated !== null && r.stats.measured !== null && r.stats.measured > r.stated + 0.5 ? "warning" : undefined }, p90: d(r.stats.p90),
                ontime: r.stats.onTimePct === null ? { t: "—", v: -1 } : { t: `${r.stats.onTimePct} %`, v: r.stats.onTimePct, tone: r.stats.onTimePct < 70 ? "warning" : undefined },
                fill: r.stats.fillPct === null ? { t: "—", v: -1 } : { t: `${r.stats.fillPct} %`, v: r.stats.fillPct }, orders: r.stats.orders,
                used: { t: `${r.days} d · ${r.basis.toLowerCase()}`, v: r.days },
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
