import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CampaignsView } from "@/components/marketing/campaigns-view";

export const metadata = { title: "Email Campaigns" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  return <CampaignsView ctx={ctx} channel="EMAIL" title="Email Campaigns" description="Designed e-mails in the recipient's language with the offer code and a button; every e-mail has an unsubscribe link. Opens are counted with a tracking image, clicks through FIRINGI's link." />;
}
