import { Building2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierList } from "@/server/compliance/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";

export const metadata = { title: "Supplier Certificates" };

export default async function SupplierCertificates() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"]);
  const rows = await supplierList(ctx);
  return (
    <>
      <PageHeader title="Supplier Certificates" icon={Building2} description="Every distributor and wholesaler: compliance score (required certificates count double), what's missing, expiring or waiting for review, and whether offers are paused." />
      <DataTable tableId="admin.compliance.suppliers" testId="supplier-compliance" empty="No suppliers yet."
        columns={[{ key: "name", label: "Supplier" }, { key: "type", label: "Type", filter: true }, { key: "score", label: "Score", type: "number" }, { key: "valid", label: "Valid", type: "number" }, { key: "expiring", label: "Expiring / grace", type: "number" }, { key: "pending", label: "To review", type: "number" }, { key: "missing", label: "Missing (required)" }, { key: "paused", label: "Selling", type: "badge", filter: true }, { key: "status", label: "Account", type: "badge", filter: true, hidden: true }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/admin/vendors/compliance/suppliers/${r.id}`,
          cells: {
            name: { t: `${r.flag ?? ""} ${r.name}`, href: `/admin/vendors/compliance/suppliers/${r.id}`, sub: r.name !== r.legalName ? r.legalName : undefined },
            type: r.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler",
            score: { t: `${r.score}`, v: r.score, tone: r.score >= 80 ? "success" : r.score >= 50 ? "warning" : "destructive" },
            valid: { t: `${r.valid}/${r.applicable}`, v: r.valid }, expiring: r.expiring, pending: r.pending,
            missing: r.missingRequired.length ? r.missingRequired.join(", ") : "—",
            paused: r.pausedWhole ? { t: "Paused", tone: "destructive" } : r.pausedOffers ? { t: `${r.pausedOffers} offers paused`, tone: "warning" } : { t: "Selling", tone: "success" },
            status: { t: r.status.replace("_", " ").toLowerCase(), tone: r.status === "APPROVED" ? "success" : "outline" },
          },
        }))} />
    </>
  );
}
