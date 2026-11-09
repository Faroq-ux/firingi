import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AuditLogView } from "@/components/audit/audit-log-view";

export const metadata = { title: "Audit Trail" };

export default async function Page({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.audit.view"]);
  return <AuditLogView ctx={ctx} title="Audit Trail" basePath="/admin/risk/audit-trail" params={await searchParams} />;
}
