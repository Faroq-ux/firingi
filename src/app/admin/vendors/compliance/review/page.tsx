import { ClipboardCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { reviewQueue } from "@/server/compliance/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Certificate Review" };

export default async function CertificateReview() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"]);
  const rows = await reviewQueue(ctx);
  return (
    <>
      <PageHeader title="Certificate Review" icon={ClipboardCheck} description="Certificates suppliers uploaded, oldest first. Open one to check the file, correct the expiry date or number, and approve or reject it. A renewal replaces the approved certificate only once you approve it." />
      <DataTable tableId="admin.compliance.review" testId="review-table" empty="Nothing waiting for review."
        columns={[{ key: "cert", label: "Certificate", filter: true }, { key: "supplier", label: "Supplier" }, { key: "type", label: "Supplier type", filter: true }, { key: "number", label: "Number" }, { key: "expires", label: "Valid until", type: "date" }, { key: "uploaded", label: "Uploaded", type: "date" }, { key: "req", label: "", type: "badge", filter: true }]}
        rows={rows.map((c) => ({
          id: c.id, href: `/admin/vendors/compliance/certificates/${c.id}`,
          cells: {
            cert: { t: c.type.name, href: `/admin/vendors/compliance/certificates/${c.id}`, sub: c.fileName }, supplier: { t: `${c.company.country.flag ?? ""} ${c.company.tradeName ?? c.company.legalName}`, href: `/admin/vendors/compliance/suppliers/${c.company.id}` },
            type: c.company.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler", number: c.number ?? "—",
            expires: { t: c.expiresOn ? formatDate(c.expiresOn, "en") : "—", v: c.expiresOn?.getTime() ?? 0 }, uploaded: { t: formatDate(c.createdAt, "en", true), v: c.createdAt.getTime() },
            req: c.type.required ? { t: "Required", tone: "destructive" } : { t: "Optional", tone: "outline" },
          },
        }))} />
    </>
  );
}
