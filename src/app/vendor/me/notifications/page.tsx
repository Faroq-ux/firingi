import { pagePortal } from "@/server/rbac/guard";
import { MyNotifications } from "@/components/notifications/views";

export const metadata = { title: "Notifications" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  return <MyNotifications ctx={ctx} base="/vendor" />;
}
