import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { TemplatesAdmin } from "@/components/admin/notifications-admin";

export const metadata = { title: "Notification Templates" };

export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string; channel?: string; locale?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.notifications.view", "admin.notifications.manage"]);
  return <TemplatesAdmin ctx={ctx} sp={await searchParams} />;
}
