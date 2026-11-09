import { pagePortal } from "@/server/rbac/guard";
import { NotificationSettings } from "@/components/notifications/views";

export const metadata = { title: "Notification settings" };

export default async function Page() {
  const ctx = await pagePortal("buy");
  return <NotificationSettings ctx={ctx} />;
}
