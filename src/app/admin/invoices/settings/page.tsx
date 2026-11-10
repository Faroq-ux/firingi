import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { IbanForm } from "@/components/risk/forms";
import { invoiceSettings } from "@/server/data/catalogue-admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Invoice Settings" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.tax.manage", "admin.invoices.view", "admin.settings.view"]);
  const { series, entities } = await invoiceSettings(ctx);
  return (
    <>
      <PageHeader title="Invoice Settings" description="Series are created automatically per year and document type. Numbers are gap-free and issued documents can't be changed." />
      <Card className="mb-4 border-warning/50"><CardContent className="pt-5 text-sm">
        <b>Fiscal provider: internal (test).</b> Portuguese invoices must be issued by AT-certified software. Documents issued now carry ATCUD, hash chain and QR data but are marked
        &quot;NOT A FISCAL DOCUMENT&quot;. Connect a certified provider (e.g. InvoiceXpress, Moloni, Vendus) before go-live — see <code>src/server/invoicing/provider.ts</code>.
      </CardContent></Card>
      <Card className="mb-4"><CardHeader><CardTitle>Issuing entities</CardTitle></CardHeader><CardContent className="text-sm">
        {entities.map((e) => (
          <div key={e.id} className="space-y-2">
            <p>{e.legalName} · NIF {e.taxId} · {e.vatNumber} · {e.addressLine}, {e.postalCode} {e.city}</p>
            {can(ctx, "admin.settings.manage") ? <IbanForm legalEntityId={e.id} iban={e.iban} /> : <p className="font-mono">IBAN {e.iban ?? "—"}</p>}
            <p className="text-xs text-muted-foreground">Changing the IBAN customers pay to needs a second person (Users › Approval Workflows).</p>
          </div>
        ))}
      </CardContent></Card>
      <Table>
        <THead><TR><TH>Series</TH><TH>Type</TH><TH>Year</TH><TH className="text-right">Next number</TH><TH>AT validation code (ATCUD)</TH></TR></THead>
        <TBody>{series.map((s) => <TR key={s.id}><TD className="font-mono">{s.prefix}</TD><TD>{s.docType.replace("_", " ").toLowerCase()}</TD><TD>{s.year}</TD><TD className="text-right tabular-nums">{s.nextNumber}</TD><TD>{s.atcudValidationCode ?? "not registered (uses 0)"}</TD></TR>)}</TBody>
      </Table>
    </>
  );
}
