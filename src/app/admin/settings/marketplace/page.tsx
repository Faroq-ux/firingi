import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PlatformSettingsPage } from "@/components/admin/platform-settings-page";

export const metadata = { title: "Marketplace Settings" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  return <PlatformSettingsPage ctx={ctx} page="marketplace" />;
}
