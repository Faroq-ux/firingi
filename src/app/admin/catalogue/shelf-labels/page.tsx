import { Tags } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { slAdmin } from "@/server/labels/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { FindShopForLabels, ShelfLabelCompanySwitch, ShelfLabelSettingsForm } from "@/components/labels/shelf-labels-admin";

export const metadata = { title: "Shelf Labels" };

/** FIRINGI (English): shelf price labels for shops — on/off, who, what a label may show, countries, single businesses. */
export default async function ShelfLabelsAdminPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage", "admin.catalogue.manage", "admin.catalogue.view"]);
  const d = await slAdmin(ctx);
  return (
    <>
      <PageHeader icon={Tags} title="Shelf Labels" description="Shops and wholesale counters print price labels for their shelves: products bought on FIRINGI (price = cost per item + their margin, incl. VAT) or till items, with the product's own barcode so their till scans it, price per kg / litre, promos. A4 sheets, shelf-edge strips and label-printer rolls." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-md">
        <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Businesses using it</div><div className="text-2xl font-semibold" data-testid="sla-shops">{d.shops}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Labels</div><div className="text-2xl font-semibold">{d.labels}</div></CardContent></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Settings</CardTitle><CardDescription>For all shops; single businesses below override it.</CardDescription></CardHeader>
          <CardContent>{d.manage ? <ShelfLabelSettingsForm initial={d.settings} countries={d.countries} /> : <p className="text-sm text-muted-foreground">You can view these settings; changing them needs the settings or catalogue manage right.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Single businesses</CardTitle><CardDescription>Turn labels on or off for one shop or wholesaler, whatever the country setting.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {d.manage && <FindShopForLabels />}
            <Table data-testid="sla-overrides">
              <THead><TR><TH>Business</TH><TH>Setting</TH></TR></THead>
              <TBody>
                {d.overrides.length === 0 && <TR><TD colSpan={2} className="text-sm text-muted-foreground">No single-business settings.</TD></TR>}
                {d.overrides.map((o) => (
                  <TR key={o.id}><TD><div className="font-medium">{o.name}</div><div className="text-xs text-muted-foreground">{o.type.toLowerCase()}</div></TD>
                    <TD>{d.manage ? <ShelfLabelCompanySwitch companyId={o.id} state={o.state ?? "DEFAULT"} /> : o.state}</TD></TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
