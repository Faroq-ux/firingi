import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { AuditLogView } from "@/components/audit/audit-log-view";

export const metadata = { title: "Audit Logs" };

export default async function Page({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.audit.view", "admin.settings.view"]);
  return <AuditLogView ctx={ctx} title="Audit Logs" basePath="/admin/settings/audit-logs" params={await searchParams} />;
}
