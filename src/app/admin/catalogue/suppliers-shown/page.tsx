import { Store } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { CH_VIEW, cartHelpAdmin } from "@/server/catalogue/cart-help";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CartHelpForm, FindSupplierForName, SupplierNameSwitch, SupplierNamesForm } from "@/components/catalogue/cart-help-admin";

export const metadata = { title: "Suppliers & Minimums" };

/** FIRINGI (English): help customers buying from several wholesalers reach each minimum; supplier names or "FIRINGI <area>". */
export default async function SuppliersShownPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, CH_VIEW);
  const d = await cartHelpAdmin(ctx);
  const view = <p className="text-sm text-muted-foreground">You can view these settings; changing them needs the settings or catalogue manage right.</p>;
  return (
    <>
      <PageHeader icon={Store} title="Suppliers & Minimums" description="When customers choose their own wholesalers: help them fill each supplier's minimum order instead of splitting the cart, and decide whether buyers see the wholesaler's name or “FIRINGI + area” (e.g. FIRINGI Almada). In FIRINGI ordering mode customers see FIRINGI only." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Supplier minimums</CardTitle><CardDescription>Suppliers in the cart first, minimum badges, cart suggestions.</CardDescription></CardHeader>
          <CardContent>{d.manage ? <CartHelpForm initial={d.help} countries={d.countries} /> : view}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Supplier names</CardTitle><CardDescription>Everywhere buyers shop and order: results, product pages, supplier list, cart, orders, dashboard, phone app and notifications. Invoices are always FIRINGI&apos;s.</CardDescription></CardHeader>
          <CardContent>{d.manage ? <SupplierNamesForm initial={d.names} countries={d.countries} /> : view}</CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>Single suppliers</CardTitle><CardDescription>“FIRINGI + area” uses the city of the supplier&apos;s warehouse (else pickup point, else head office); suppliers in the same city are numbered.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {d.manage && <FindSupplierForName />}
          <Table data-testid="sn-suppliers">
            <THead><TR><TH>Supplier</TH><TH>Shown as</TH><TH>Setting</TH></TR></THead>
            <TBody>
              {d.suppliers.map((s) => (
                <TR key={s.id} data-testid="sn-row">
                  <TD><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.type.toLowerCase()} · {s.country}</div></TD>
                  <TD className="text-sm">{s.area}</TD>
                  <TD>{d.manage ? <SupplierNameSwitch companyId={s.id} state={s.state} /> : s.state}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
