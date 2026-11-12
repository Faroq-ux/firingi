import { ScrollText } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { complianceAudit } from "@/server/compliance/service";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Compliance Audit" };
const pretty = (a: string) => a === "company.status.approved_anyway" ? "account approved without documents" : a.replace(/^compliance\./, "").replace(/_/g, " ");
const tone = (a: string) => /rejected|revoked|paused|expired|anyway|badge_hidden|type_badge_off/.test(a) ? "warning" as const : /approved|resumed|granted|rechecked/.test(a) ? "success" as const : "outline" as const;

export default async function ComplianceAuditPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"]);
  const rows = await complianceAudit(ctx);
  const summary = (v: unknown) => {
    if (!v || typeof v !== "object") return "—";
    const o = v as Record<string, unknown>;
    return ["note", "reason", "until", "expiresOn", "type", "key", "whole", "offers", "waived"].filter((k) => o[k] !== undefined && o[k] !== null && !(Array.isArray(o[k]) && !(o[k] as unknown[]).length)).map((k) => `${k}: ${Array.isArray(o[k]) ? (o[k] as unknown[]).join(", ") : typeof o[k] === "string" && /^\d{4}-\d{2}-\d{2}T/.test(o[k] as string) ? (o[k] as string).slice(0, 10) : String(o[k])}`).join(" · ") || "—";
  };
  return (
    <>
      <PageHeader title="Compliance Audit" icon={ScrollText} description="Every compliance decision: uploads, approvals, rejections, revocations, re-checks, grace periods, badge changes, automatic pauses / resumes, certificate type changes — and accounts approved without the certificate code or POS invoice. The log is append-only." />
      <DataTable tableId="admin.compliance.audit" testId="compliance-audit" empty="No compliance activity yet."
        columns={[{ key: "at", label: "When", type: "date" }, { key: "action", label: "Action", type: "badge", filter: true }, { key: "company", label: "Supplier / company" }, { key: "cert", label: "Certificate", filter: true }, { key: "by", label: "By", filter: true }, { key: "detail", label: "Detail" }]}
        rows={rows.map((a) => ({
          id: a.id, href: a.entityType === "Certificate" ? `/admin/vendors/compliance/certificates/${a.entityId}` : a.company ? `/admin/companies/${a.company.id}` : undefined,
          cells: {
            at: { t: formatDate(a.at, "en", true), v: a.at.getTime() }, action: { t: pretty(a.action), tone: tone(a.action) },
            company: a.company ? { t: a.company.name, href: `/admin/companies/${a.company.id}` } : "—", cert: a.certificate ?? (a.entityType === "CertificateType" ? "(type)" : "—"),
            by: a.actor?.name ?? "system (daily job)", detail: summary(a.after),
          },
        }))} />
    </>
  );
}
