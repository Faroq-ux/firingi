import { Building2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { legalEntities } from "@/server/launch/service";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LegalEntityForm } from "@/components/launch/admin";

export const metadata = { title: "Company Settings" };
export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const { rows, countries } = await legalEntities(ctx);
  const manage = ctx.permissions.has("admin.settings.manage");
  const opts = countries.map((c) => ({ code: c.code, label: `${c.flag ?? ""} ${pickLocalized(c.name, "en")}` }));
  return (
    <>
      <PageHeader title="Company Settings" icon={Building2}
        description="FIRINGI's legal entities: the seller on every sales invoice. The entity of the buyer's country issues the invoice, so every country with buyers needs one. The bank account (IBAN) is changed under Payment Settings (a second person approves it)." />
      <div className="grid gap-4 xl:grid-cols-2" data-testid="entities">
        {rows.map((e) => (
          <Card key={e.id} data-testid={`entity-${e.country.code}`}>
            <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{e.country.flag} {e.legalName} {!e.isActive && <Badge variant="outline">inactive</Badge>}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">IBAN: <span className="font-mono text-xs">{e.iban ?? "—"}</span> {e.iban && !e.ibanOk && <Badge variant="destructive">not valid</Badge>} <span className="text-muted-foreground">· {e.invoices} invoices issued</span></p>
              {manage ? (
                <LegalEntityForm countries={opts} entity={{ id: e.id, countryCode: e.country.code, legalName: e.legalName, taxId: e.taxId, vatNumber: e.vatNumber, addressLine: e.addressLine, postalCode: e.postalCode, city: e.city, email: e.email, phone: e.phone, invoices: e.invoices }} />
              ) : (
                <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">NIF</dt><dd>{e.taxId}</dd>
                  <dt className="text-muted-foreground">VAT number</dt><dd>{e.vatNumber}</dd>
                  <dt className="text-muted-foreground">Address</dt><dd>{e.addressLine}, {e.postalCode} {e.city}</dd>
                  <dt className="text-muted-foreground">Invoicing e-mail</dt><dd>{e.email}</dd>
                  <dt className="text-muted-foreground">Phone</dt><dd>{e.phone ?? "—"}</dd>
                </dl>
              )}
            </CardContent>
          </Card>
        ))}
        {!rows.length && <Card><CardContent className="pt-5 text-sm text-muted-foreground" data-testid="no-entities">No invoicing entity yet — add FIRINGI&rsquo;s details for each country where buyers order. No sales invoice can be issued without one.</CardContent></Card>}
      </div>
      {manage && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Add an invoicing entity</CardTitle></CardHeader>
          <CardContent><LegalEntityForm countries={opts} /></CardContent>
        </Card>
      )}
    </>
  );
}
