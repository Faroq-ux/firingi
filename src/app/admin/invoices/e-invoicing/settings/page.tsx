import { Settings2 } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { countriesForSettings, einvoiceSettings, entitiesForSettings } from "@/server/einvoice/service";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EInvoiceSettingsForm, EntityForm } from "@/components/einvoice/admin";

export const metadata = { title: "E-Invoicing Settings" };
export const dynamic = "force-dynamic";

export default async function EInvoicingSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage", "admin.tax.manage", "admin.finance.view", "admin.invoices.view"]);
  const [s, entities, countries] = await Promise.all([
    einvoiceSettings(), entitiesForSettings(ctx),
    countriesForSettings(ctx),
  ]);
  const manage = can(ctx, ["admin.settings.manage", "admin.tax.manage"]);
  return (
    <>
      <PageHeader title="E-Invoicing Settings" icon={Settings2} description="Which documents go out electronically, how per country (format and service), the checks, the archive period, and the language rules. Every switch can be turned off." />
      <Card><CardContent className="pt-5">
        {manage ? <EInvoiceSettingsForm initial={s} countries={countries.map((c) => ({ code: c.code, name: pickLocalized(c.name, "en"), flag: c.flag }))} /> : <p className="text-sm text-muted-foreground">You can see but not change these settings.</p>}
      </CardContent></Card>
      <Card className="mt-4"><CardHeader><CardTitle>FIRINGI companies</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Each company&apos;s document language (default: its country&apos;s), an optional second language, whether its own language must always be on its documents, and its Peppol id (needed to send through Peppol).</p>
        {entities.map((e) => manage ? <EntityForm key={e.id} e={e} /> : <p key={e.id} className="text-sm">{e.country.flag} {e.legalName} — {e.language ?? e.country.defaultLanguageCode} · Peppol {e.peppolId ?? "—"}</p>)}
      </CardContent></Card>
    </>
  );
}
