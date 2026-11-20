import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { companyRows, countryOptions, payLaterSettings } from "@/server/pay-later/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FindBusiness, OwnLimit, PayLaterSettingsForm, PayLaterSwitch } from "@/components/pay-later/admin";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Pay Later Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.manage", "admin.settings.manage"]);
  const [s, countries, rows] = await Promise.all([payLaterSettings(), countryOptions(ctx), companyRows(ctx)]);
  return (
    <>
      <PageHeader title="Pay Later Settings" icon={CalendarClock} description="Switch every part of pay later on or off: the feature, who can use it, each term and its fee, who finances it in each country, limits — and each business on its own." />
      <Link href="/admin/finance/pay-later" className="mb-3 inline-block text-sm text-primary hover:underline">← Pay Later</Link>
      <Card className="mb-6"><CardContent className="pt-6"><PayLaterSettingsForm initial={s} countries={countries} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Switch pay later on or off for one business, and give it its own credit limit with FIRINGI (empty = the default for its type).</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {rows.length > 0 && (
            <ul className="divide-y" data-testid="pls-companies">
              {rows.map((r) => (
                <li key={r.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="pls-company">
                  <span className="min-w-0 flex-1 break-words">{r.name} <span className="text-xs text-muted-foreground">· {r.type === "WHOLESALER" ? "Wholesaler" : "Customer"} · owes {formatMoney(r.used, "en")}</span></span>
                  <PayLaterSwitch companyId={r.companyId} state={r.state} />
                  <OwnLimit companyId={r.companyId} limit={r.ownLimit} fallback={r.defaultLimit} />
                </li>
              ))}
            </ul>
          )}
          <FindBusiness kind="paylater" types={["CUSTOMER", "WHOLESALER"]} />
        </CardContent>
      </Card>
    </>
  );
}
