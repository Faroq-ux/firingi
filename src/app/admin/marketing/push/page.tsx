import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CampaignsView } from "@/components/marketing/campaigns-view";

export const metadata = { title: "Push Notifications" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  return <CampaignsView ctx={ctx} channel="PUSH" title="Push Notifications" description="Push messages to the phones and browsers where people allowed FIRINGI notifications. Tapping the message opens the campaign's page (counted as a click)." />;
}
