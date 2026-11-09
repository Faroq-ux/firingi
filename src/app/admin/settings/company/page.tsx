import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listLegalEntities } from "@/server/data/geo";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Company Settings" };

export default async function CompanySettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const entities = await listLegalEntities(ctx);
  return (
    <>
      <PageHeader title="Company Settings" description="FIRINGI legal entities. The entity of the buyer's country is the seller on every sales invoice. Editing arrives with invoice settings (Phase 5)." />
      <div className="grid gap-4 md:grid-cols-2">
        {entities.map((e) => (
          <Card key={e.id}>
            <CardHeader><CardTitle>{e.country.flag} {e.legalName}</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">NIF</dt><dd>{e.taxId}</dd>
                <dt className="text-muted-foreground">VAT number</dt><dd>{e.vatNumber}</dd>
                <dt className="text-muted-foreground">Address</dt><dd>{e.addressLine}, {e.postalCode} {e.city}</dd>
                <dt className="text-muted-foreground">Invoicing e-mail</dt><dd>{e.email}</dd>
                <dt className="text-muted-foreground">Phone</dt><dd>{e.phone ?? "—"}</dd>
                <dt className="text-muted-foreground">IBAN</dt><dd className="font-mono text-xs">{e.iban ?? "—"}</dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
