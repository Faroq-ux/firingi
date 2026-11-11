import { AlertTriangle, Boxes, CircleDollarSign, PackageX, TimerReset, Warehouse } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminInventoryOverview } from "@/server/inventory/admin";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Inventory Overview" };

export default async function AdminInventoryOverview() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const o = await adminInventoryOverview(ctx);
  const L = "en";
  return (
    <>
      <PageHeader title="Inventory Overview" description="Stock held by every supplier and by FIRINGI's own warehouse, valued at each supplier's weighted average cost. Expiry counts batches within 14 days." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" data-testid="admin-inventory-kpis">
        <Tile icon={CircleDollarSign} label="Stock value (all)" value={Number(o.total)} fmt="money" locale={L} tone="tone-violet" i={0} />
        <Tile icon={Warehouse} label="FIRINGI warehouse" value={Number(o.inHouseValue)} fmt="money" locale={L} tone="tone-blue" i={1} />
        <Tile icon={Boxes} label="Units in stock" value={o.units} locale={L} tone="tone-teal" i={2} />
        <Tile icon={AlertTriangle} label="At / below reorder" value={o.low} locale={L} tone="tone-orange" i={3} />
        <Tile icon={TimerReset} label="Expiring batches" value={o.expiring} locale={L} tone="tone-pink" i={4} href="/admin/inventory/expiring" />
        <Tile icon={PackageX} label="Expired batches" value={o.expired} locale={L} tone="tone-pink" i={5} hint={formatMoney(o.expiredValue, L)} href="/admin/inventory/expiring?days=0" />
      </div>
      <DataTable tableId="admin.inventory" testId="admin-inventory-table" empty="No stock recorded yet." exportName="inventory-by-supplier"
        columns={[
          { key: "name", label: "Supplier" }, { key: "type", label: "Type", type: "badge", filter: true }, { key: "value", label: "Stock value", type: "money" }, { key: "units", label: "Units", type: "number" },
          { key: "lines", label: "Products", type: "number" }, { key: "low", label: "Low", type: "number" }, { key: "expiring", label: "Expiring", type: "number" }, { key: "expired", label: "Expired", type: "number" },
          { key: "noCost", label: "No cost", type: "number", hidden: true }, { key: "openPos", label: "Open POs", type: "number" },
        ]}
        rows={o.rows.map((r) => ({
          id: r.id, href: `/admin/companies/${r.id}`,
          cells: {
            name: { t: r.name, sub: r.inHouse ? "FIRINGI in-house" : undefined }, type: { t: r.inHouse ? "In-house" : r.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler", tone: r.inHouse ? "default" : "secondary" },
            value: { t: formatMoney(r.value, L), v: Number(r.value) }, units: r.units, lines: r.lines, low: r.low || null,
            expiring: r.expiring ? { t: String(r.expiring), v: r.expiring, tone: "warning" } : null, expired: r.expired ? { t: String(r.expired), v: r.expired, tone: "destructive" } : null,
            noCost: r.noCost || null, openPos: r.openPos || null,
          },
        }))} />
    </>
  );
}
