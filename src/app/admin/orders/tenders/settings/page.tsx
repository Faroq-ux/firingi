import Link from "next/link";
import { Gavel } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { companySwitches, tenderSettings } from "@/server/tenders/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FindBusiness, TenderSettingsForm, TenderSwitch } from "@/components/pay-later/admin";

export const metadata = { title: "Tender Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.manage", "admin.settings.manage"]);
  const [s, sw] = await Promise.all([tenderSettings(), companySwitches(ctx)]);
  const TYPE: Record<string, string> = { CUSTOMER: "Customer", WHOLESALER: "Wholesaler", DISTRIBUTOR: "Distributor" };
  return (
    <>
      <PageHeader title="Tender Settings" icon={Gavel} description="Switch every part of open tenders on or off: who posts, who bids, approval, invitations, target prices, pay later at the award, limits — and each business on its own." />
      <Link href="/admin/orders/tenders" className="mb-3 inline-block text-sm text-primary hover:underline">← Tenders</Link>
      <Card className="mb-6"><CardContent className="pt-6"><TenderSettingsForm initial={s} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Default follows the types above; switch one business on or off on its own.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {sw.length > 0 && <ul className="divide-y" data-testid="tds-companies">{sw.map((x) => <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {TYPE[x.type] ?? x.type}</span></span><TenderSwitch companyId={x.companyId} state={x.state} /></li>)}</ul>}
          <FindBusiness kind="tenders" types={["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"]} />
        </CardContent>
      </Card>
    </>
  );
}
