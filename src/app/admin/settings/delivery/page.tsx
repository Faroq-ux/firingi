import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { multiOrderPolicy } from "@/server/services/delivery-settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MultiOrderPolicyForm } from "@/components/admin/delivery-admin-forms";

export const metadata = { title: "Delivery Settings" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage", "admin.delivery.view"]);
  const policy = await multiOrderPolicy();
  return (
    <>
      <PageHeader title="Delivery Settings" description="Multi-order delivery: may one driver carry several orders on the same trip?" />
      <Card className="max-w-2xl"><CardHeader><CardTitle>Multi-order delivery</CardTitle></CardHeader>
        <CardContent><MultiOrderPolicyForm policy={policy} canEdit={can(ctx, "admin.settings.manage")} /></CardContent>
      </Card>
    </>
  );
}
