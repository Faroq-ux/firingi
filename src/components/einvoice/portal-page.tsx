/** Phase 46 — the customer's / supplier's E-Invoicing page (shared by both portals). */
import { FileCode2 } from "lucide-react";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/einvoice/service";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { FORMAT_SHORT, type EFormat } from "@/lib/einvoice";
import { EStatus } from "./status";
import { ProfileForm } from "./profile";
import { einLabels, fill } from "./labels";

export async function EInvoicingPortalPage({ ctx, vendor }: { ctx: Ctx; vendor: boolean }) {
  const { l, locale } = await einLabels();
  const v = await getProfile(ctx);
  let cname = pickLocalized(v.company.country.name, locale);
  try { cname = new Intl.DisplayNames([locale], { type: "region" }).of(v.company.country.code) ?? cname; } catch { /* keep the stored name */ }
  const fmt = v.route ? FORMAT_SHORT[v.route.format as EFormat] : "";
  const routeText = !v.route ? fill(l.routeOff, { country: cname }) : v.route.mandatory ? fill(l.routeMandatory, { country: cname, format: fmt }) : fill(l.routeOnRequest, { country: cname, format: fmt });
  const day = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
  return (
    <>
      <PageHeader title={l.title} icon={FileCode2} description={vendor ? l.introVendor : l.intro} />
      <Card className="mb-4"><CardContent className="pt-5 text-sm" data-testid="ep-route">{routeText}</CardContent></Card>
      <Card className="mb-4"><CardContent className="pt-5">
        <ProfileForm l={l} locale={locale} profile={v.profile} country={v.company.country.code} countryLanguage={v.company.country.defaultLanguageCode} vendor={vendor}
          allowLanguage={v.settings.allowCustomerLanguage} allowBilingual={v.settings.allowBilingual} allowSelfBilling={v.settings.selfBilling} canEdit={v.canEdit} />
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{l.docsTitle}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="ep-docs">
          <THead><TR><TH>{l.colDocument}</TH><TH>{l.colDate}</TH><TH>{l.colFormat}</TH><TH>{l.colStatus}</TH><TH>{l.colRef}</TH><TH /></TR></THead>
          <TBody>
            {v.documents.length === 0 && <EmptyRow colSpan={6}>{l.docsEmpty}</EmptyRow>}
            {v.documents.map((d) => (
              <TR key={d.id}>
                <TD><span className="font-mono text-xs">{d.number}</span><div className="text-xs text-muted-foreground">{l[`kind.${d.kind}`] ?? d.kind}</div></TD>
                <TD className="whitespace-nowrap text-xs">{day(d.createdAt)}</TD>
                <TD className="text-xs">{FORMAT_SHORT[d.format as EFormat] ?? d.format}</TD>
                <TD><EStatus status={d.status} label={l[`status.${d.status}`]} /></TD>
                <TD className="break-all text-xs">{d.networkRef ?? "—"}</TD>
                <TD>{["SENT", "DELIVERED", "ACCEPTED", "RECEIVED", "MATCHED"].includes(d.status) && <a className="text-xs text-primary hover:underline" href={`/api/einvoice/${d.id}/xml`}>{l.download}</a>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
