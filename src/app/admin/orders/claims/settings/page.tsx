import { Settings2 } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { claimSettings } from "@/server/claims/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ClaimSettingsForm } from "@/components/claims/forms";

export const metadata = { title: "Claim Settings" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.claims.manage", "admin.orders.view", "admin.orders.manage"]);
  const s = await claimSettings();
  return (
    <>
      <PageHeader title="Claim Settings" description="How long customers can report a problem, how fast suppliers answer and FIRINGI decides, when a photo is required, and when quality alerts fire. Credits above the approval threshold (Risk › Approvals) need a second person." icon={Settings2} />
      <Card><CardContent className="pt-6"><ClaimSettingsForm values={s} canEdit={can(ctx, "admin.claims.manage")} /></CardContent></Card>
    </>
  );
}
