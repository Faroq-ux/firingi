import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listTaxRates } from "@/server/data/geo";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Tax Rules" };

export default async function TaxRulesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage", "admin.invoices.view", "admin.tax.manage"]);
  const [rows, locale, { view }] = await Promise.all([listTaxRates(ctx), getLocale(), searchParams]);
  return (
    <>
      <PageHeader
        title={view === "vat" ? "VAT / GST" : "Country Tax Rules"}
        description="Rates are versioned with valid-from dates and never edited in place. Portugal and Spain are complete (incl. Madeira, Azores and Canary Islands); other EU countries carry the standard rate for reference. Confirm all rates with your accountant before go-live."
      />
      <Table>
        <THead><TR><TH>Country</TH><TH>Region</TH><TH>Category</TH><TH>Tax</TH><TH className="text-right">Rate</TH><TH>SAF-T code</TH><TH>Valid from</TH></TR></THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>{r.country.flag} {pickLocalized(r.country.name, locale)}</TD>
              <TD>{r.region ? pickLocalized(r.region.name, locale) : <span className="text-muted-foreground">Mainland / national</span>}</TD>
              <TD><Badge variant="secondary">{r.taxCategory.code}</Badge></TD>
              <TD>{r.taxType}</TD>
              <TD className="text-right font-mono">{Number(r.rate).toLocaleString(locale)}%</TD>
              <TD><code className="text-xs">{r.saftCode ?? "—"}</code></TD>
              <TD className="text-muted-foreground">{formatDate(r.validFrom, locale)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
