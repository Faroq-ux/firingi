import Link from "next/link";
import { BadgePercent } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { rebateSettings, supplierSwitches } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RebateSettingsForm, SupplierSwitch } from "@/components/rebates/admin";

export const metadata = { title: "Rebate Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"]);
  const [s, sup] = await Promise.all([rebateSettings(), supplierSwitches(ctx)]);
  return (
    <>
      <PageHeader title="Rebate Settings" icon={BadgePercent} description="Switch every part of rebates & bonuses on or off: kinds, periods, targeting, who creates and who earns, approval, limits and timings." />
      <Link href="/admin/pricing/rebates" className="mb-3 inline-block text-sm text-primary hover:underline">← Rebates & Bonuses</Link>
      <Card className="mb-6"><CardContent className="pt-6"><RebateSettingsForm initial={s} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Suppliers</CardTitle><CardDescription>Default follows &quot;who may create deals&quot; above; switch one supplier on or off on its own.</CardDescription></CardHeader>
        <CardContent>
          <ul className="divide-y" data-testid="rb-suppliers">
            {sup.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="rb-supplier">
                <span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler"} · {x.deals} deals</span></span>
                <SupplierSwitch companyId={x.id} state={x.state} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
