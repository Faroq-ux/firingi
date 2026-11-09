import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { InboxAdmin } from "@/components/admin/notifications-admin";

export const metadata = { title: "Customer Messages" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.notifications.view", "admin.notifications.manage", "admin.messages.manage"]);
  return <InboxAdmin ctx={ctx} audience="CUSTOMER" title="Customer Messages" from={(await searchParams).from} />;
}
