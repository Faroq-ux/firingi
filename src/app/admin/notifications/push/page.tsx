import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ChannelAdmin } from "@/components/admin/notifications-admin";

export const metadata = { title: "PUSH" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.notifications.view", "admin.notifications.manage"]);
  return <ChannelAdmin ctx={ctx} channel="PUSH" />;
}
