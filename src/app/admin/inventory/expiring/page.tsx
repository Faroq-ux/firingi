import Link from "next/link";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminExpiring } from "@/server/inventory/admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";

export const metadata = { title: "Expiring Stock" };
const RANGES = [0, 7, 14, 30, 90];

export default async function AdminExpiring({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 14;
  const rows = (await adminExpiring(ctx, days)).filter((b) => days > 0 || b.daysLeft < 0);
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title="Expiring Stock" description="Batches across all suppliers that expire soon or have expired and are not written off yet." />
      <nav className="mb-3 flex flex-wrap gap-2 text-sm">{RANGES.map((d) => <Link key={d} href={`?days=${d}`} className={`rounded-full border px-3 py-1 ${d === days ? "border-primary bg-primary/10 font-medium" : ""}`}>{d === 0 ? "Expired" : `Within ${d} days`}</Link>)}</nav>
      <DataTable tableId="admin.inventory-expiring" testId="admin-expiring-table" empty="Nothing expiring in this window." exportName="expiring-stock"
        columns={[{ key: "expires", label: "Best before", type: "date" }, { key: "days", label: "Days left", type: "number" }, { key: "supplier", label: "Supplier", filter: true }, { key: "product", label: "Product" }, { key: "warehouse", label: "Warehouse" }, { key: "lot", label: "Lot" }, { key: "qty", label: "On hand", type: "number" }, { key: "reserved", label: "Reserved", type: "number" }]}
        rows={rows.map((b) => ({
          id: b.id,
          cells: {
            expires: { t: date.format(b.expiresOn), v: b.expiresOn.toISOString(), tone: b.daysLeft < 0 ? "destructive" : b.daysLeft <= 7 ? "warning" : undefined },
            days: { t: b.daysLeft < 0 ? "expired" : String(b.daysLeft), v: b.daysLeft }, supplier: { t: b.supplier, sub: b.inHouse ? "FIRINGI in-house" : undefined },
            product: `${pickLocalized(b.product, "en")} · ${pickLocalized(b.packaging, "en")}${b.sku ? ` · ${b.sku}` : ""}`, warehouse: b.warehouse, lot: b.lotCode, qty: b.onHand, reserved: b.reserved || null,
          },
        }))} />
    </>
  );
}
