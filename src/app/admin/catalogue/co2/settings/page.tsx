import Link from "next/link";
import { Leaf } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { co2Settings, companySwitches } from "@/server/co2/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Co2SettingsForm, Co2Switch, FindCo2Business } from "@/components/co2/admin";

export const metadata = { title: "CO₂ Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.manage", "admin.settings.manage"]);
  const [s, sw] = await Promise.all([co2Settings(), companySwitches(ctx)]);
  return (
    <>
      <PageHeader title="CO₂ Settings" icon={Leaf} description="Switch every part of sustainability & CO₂ on or off: what the footprint counts, what people see, who takes part, the check of suppliers' values, thresholds, fuel and packaging factors — and each business on its own." />
      <Link href="/admin/catalogue/co2" className="mb-3 inline-block text-sm text-primary hover:underline">← Sustainability & CO₂</Link>
      <Card className="mb-6"><CardContent className="pt-6"><Co2SettingsForm initial={s} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Default follows &quot;who takes part&quot; above; switch one business on or off on its own.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {sw.length > 0 && <ul className="divide-y" data-testid="co2-switches">{sw.map((x) => <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type.toLowerCase()}</span></span><Co2Switch companyId={x.companyId} state={x.state} /></li>)}</ul>}
          <FindCo2Business />
        </CardContent>
      </Card>
    </>
  );
}
