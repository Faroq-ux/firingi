import { SlidersHorizontal } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canAdminManagePlanning, planningDefaults } from "@/server/planning/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PlanningDefaultsForm } from "@/components/planning/admin";

export const metadata = { title: "Planning Settings" };

export default async function Settings() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const d = await planningDefaults();
  return (
    <>
      <PageHeader title="Planning Settings" icon={SlidersHorizontal} description="FIRINGI's defaults for demand planning. Each supplier can set its own service level, order rhythm and overstock limit; these apply where it hasn't." />
      <Card className="max-w-4xl">
        <CardContent className="pt-6">
          {canAdminManagePlanning(ctx) ? <PlanningDefaultsForm initial={d} /> : (
            <dl className="grid grid-cols-2 gap-2 text-sm">{Object.entries(d).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{String(v)}</dd></div>)}</dl>
          )}
        </CardContent>
      </Card>
    </>
  );
}
