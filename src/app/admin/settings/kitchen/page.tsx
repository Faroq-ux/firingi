import Link from "next/link";
import { ChefHat } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { kitchenSettings, kitchenSwitches } from "@/server/kitchen/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FindKitchenBusiness, KitchenSettingsForm, KitchenSwitch } from "@/components/kitchen/admin";

export const metadata = { title: "Menu Costing & Waste Settings" };
export const dynamic = "force-dynamic";

/** Phase 54: every menu-costing & waste switch, the defaults and per-business switches. */
export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.settings.manage");
  const [s, sw] = await Promise.all([kitchenSettings(), kitchenSwitches(ctx)]);
  return (
    <>
      <PageHeader title="Menu Costing & Waste" icon={ChefHat} description="Restaurants and shops cost their dishes from what they bought on FIRINGI, see food cost % and margin, engineer the menu, log waste and donations. Switch every part on or off, per business type and per business." actions={<Link href="/admin/kitchen" className="text-sm text-primary hover:underline">Overview →</Link>} />
      <Card className="mb-6"><CardContent className="pt-6"><KitchenSettingsForm initial={s} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Default follows &quot;who uses it&quot; above; switch one business on or off on its own.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {sw.length > 0 && <ul className="divide-y" data-testid="kitchen-switches">{sw.map((x) => <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type.toLowerCase()}</span></span><KitchenSwitch companyId={x.companyId} state={x.state} /></li>)}</ul>}
          <FindKitchenBusiness />
        </CardContent>
      </Card>
    </>
  );
}
