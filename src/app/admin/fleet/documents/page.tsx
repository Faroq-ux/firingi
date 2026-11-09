import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { DriverApplications } from "@/components/admin/queues";

export const metadata = { title: "Driver Documents" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.fleet.view", "admin.fleet.manage"]);
  return <DriverApplications ctx={ctx} title="Driver Documents" documentsOnly />;
}
