import { ListChecks } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/assortments/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAssortmentSettings, SwitchOffVendor, VendorSwitch } from "@/components/assortments/client";

export const metadata = { title: "Customer assortments" };
export const dynamic = "force-dynamic";

export default async function AdminAssortmentsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.settings.manage"]);
  const o = await adminOverview(ctx);
  return (
    <>
      <PageHeader title="Customer assortments" icon={ListChecks}
        description="Suppliers decide what each customer can see and buy: approved lists, hidden items and must-stock lists. The lists apply in every channel through the catalogue's visibility rule." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="asa-tiles">
        {([["Suppliers with lists", o.kpis.suppliers], ["Lists", o.kpis.lists], ["Products on lists", o.kpis.items], ["Reminders sent (30 days)", o.kpis.reminders30]] as const).map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Switch assortments and each kind of list on or off; the must-stock gap and reminders.</CardDescription></CardHeader>
        <CardContent><AdminAssortmentSettings settings={o.settings} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Suppliers</CardTitle><CardDescription>Lists per supplier and the switch per supplier (switched off: its lists are ignored).</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {!o.suppliers.length ? <p className="text-sm text-muted-foreground">No supplier has lists yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="asa-suppliers">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">Supplier</th><th className="px-2 text-right">Approved</th><th className="px-2 text-right">Hidden</th><th className="px-2 text-right">Must-stock</th><th className="px-2 text-right">Active</th><th /></tr></thead>
                <tbody>
                  {o.suppliers.map((s) => (
                    <tr key={s.id} className="border-b last:border-0" data-testid="asa-supplier">
                      <td className="py-2 pr-2 font-medium">{s.name}</td><td className="px-2 text-right tabular-nums">{s.only}</td><td className="px-2 text-right tabular-nums">{s.hide}</td><td className="px-2 text-right tabular-nums">{s.must}</td><td className="px-2 text-right tabular-nums">{s.active}</td>
                      <td className="px-2 text-right"><VendorSwitch vendorId={s.id} on={s.on} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {o.disabled.length > 0 && (
            <div className="space-y-2"><p className="text-sm font-medium">Switched off for</p>
              <ul className="divide-y rounded-md border" data-testid="asa-disabled">{o.disabled.map((v) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 break-words">{v.name}</span><VendorSwitch vendorId={v.id} on={false} /></li>)}</ul>
            </div>
          )}
          <div className="space-y-2"><p className="text-sm font-medium">Switch off for a supplier</p><SwitchOffVendor /></div>
        </CardContent>
      </Card>
    </>
  );
}
