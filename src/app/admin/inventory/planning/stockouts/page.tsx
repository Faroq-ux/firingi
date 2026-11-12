import { PackageX } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminStockoutRisk, canAdminManagePlanning } from "@/server/planning/service";
import { rowLabel } from "@/server/planning/engine";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FlagSupplier } from "@/components/planning/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Stock-out Risk" };
const LABEL = { OUT: "Out of stock", LATE: "Too late", ORDER_NOW: "Order now", SOON: "Soon" } as const;
const TONE = { OUT: "destructive", LATE: "destructive", ORDER_NOW: "warning", SOON: "secondary" } as const;

export default async function Stockouts({ searchParams }: { searchParams: Promise<{ supplier?: string; urgency?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const sp = await searchParams;
  const rows = await adminStockoutRisk(ctx, { companyId: sp.supplier, urgency: sp.urgency && sp.urgency in LABEL ? sp.urgency : undefined });
  const manage = canAdminManagePlanning(ctx);
  return (
    <>
      <PageHeader title="Stock-out Risk" icon={PackageX} description="Products across suppliers that are out of stock or will run out before new goods can arrive, from the nightly plan. Customers can't buy what a supplier doesn't have — ask the supplier to restock (in-app and e-mail, at most every 3 days per product)." />
      <Card>
        <CardContent className="pt-6">
          <DataTable tableId="admin.planning.stockouts" testId="stockouts" empty="Nothing is about to run out."
            columns={[
              { key: "urgency", label: "Status", type: "badge", filter: true }, { key: "supplier", label: "Supplier", filter: true }, { key: "product", label: "Product" }, { key: "wh", label: "Warehouse", filter: true },
              { key: "stock", label: "Stock + on order", type: "number" }, { key: "daily", label: "Sells / day", type: "number" }, { key: "out", label: "Runs out", type: "date" },
              { key: "lead", label: "Lead time", type: "number" }, { key: "qty", label: "Suggested", type: "number" }, { key: "act", label: "" },
            ]}
            rows={rows.map((r) => ({
              id: r.id,
              cells: {
                urgency: { t: LABEL[r.urgency], tone: TONE[r.urgency] },
                supplier: { t: r.company.tradeName ?? r.company.legalName, sub: r.company.isInHouse ? "FIRINGI in-house" : undefined },
                product: rowLabel({ product: r.offer.packaging.variant.product.name, packaging: r.offer.packaging.name, sku: r.offer.vendorSku }, "en"),
                wh: r.address.label, stock: { t: `${r.usable} + ${r.incoming}`, v: r.usable + r.incoming }, daily: { t: r.dailyDemand.toFixed(1), v: r.dailyDemand },
                out: r.runsOutOn ? { t: formatDate(r.runsOutOn, "en"), v: r.runsOutOn.getTime() } : { t: "now", v: 0 }, lead: { t: `${r.leadTimeDays} d`, v: r.leadTimeDays }, qty: r.qty,
                act: { t: "", node: manage ? <FlagSupplier id={r.id} flaggedAt={r.flaggedAt ? formatDate(r.flaggedAt, "en", true) : null} /> : null },
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
