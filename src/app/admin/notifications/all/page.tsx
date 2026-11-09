import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { MessageLog } from "@/components/admin/notifications-admin";

export const metadata = { title: "Notifications" };

export default async function Page({ searchParams }: { searchParams: Promise<{ channel?: string; status?: string; event?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.notifications.view", "admin.notifications.manage"]);
  return <MessageLog ctx={ctx} sp={await searchParams} />;
}
