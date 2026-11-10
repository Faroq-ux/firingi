import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CampaignsView } from "@/components/marketing/campaigns-view";

export const metadata = { title: "Campaigns" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  return <CampaignsView ctx={ctx} title="Campaigns" description="Messages to customers and suppliers — by e-mail, push, in-app, SMS and WhatsApp — in each person's language, optionally promoting an offer or coupon. Results: delivered, opened (e-mail), clicked, and orders placed within 7 days of a click or with the campaign's offer." />;
}
