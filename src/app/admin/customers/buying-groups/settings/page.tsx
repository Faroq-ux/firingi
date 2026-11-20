import Link from "next/link";
import { Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { companySwitches, groupSettings } from "@/server/buying-groups/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddBusinessSwitch, GroupSettingsForm, GroupSwitch } from "@/components/buying-groups/admin";

export const metadata = { title: "Buying Group Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.manage", "admin.settings.manage"]);
  const [s, sw] = await Promise.all([groupSettings(), companySwitches(ctx)]);
  return (
    <>
      <PageHeader title="Buying Group Settings" icon={Users} description="Switch every part of buying groups on or off: who joins and who starts groups (customers, wholesalers), approval, group prices, pooled rebates, group orders, reports, join requests and limits." />
      <Link href="/admin/customers/buying-groups" className="mb-3 inline-block text-sm text-primary hover:underline">← Buying Groups</Link>
      <Card className="mb-6"><CardContent className="pt-6"><GroupSettingsForm initial={s} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Default follows &quot;who takes part&quot; above; switch one customer or wholesaler on or off on its own.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {sw.length > 0 && (
            <ul className="divide-y" data-testid="bg-switches">
              {sw.map((x) => (
                <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="bg-switch-row">
                  <span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type === "WHOLESALER" ? "Wholesaler" : "Customer"}</span></span>
                  <GroupSwitch companyId={x.companyId} state={x.state} />
                </li>
              ))}
            </ul>
          )}
          <AddBusinessSwitch />
        </CardContent>
      </Card>
    </>
  );
}
