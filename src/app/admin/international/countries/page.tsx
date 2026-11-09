import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCountries } from "@/server/data/geo";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { OrderModeSelect } from "@/components/allocation/forms";
import { can } from "@/server/rbac/guard";

export const metadata = { title: "Countries" };

const On = ({ on }: { on: boolean }) => <Badge variant={on ? "success" : "secondary"}>{on ? "Open" : "—"}</Badge>;

export default async function CountriesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage"]);
  const [rows, locale] = await Promise.all([listCountries(ctx), getLocale()]);
  return (
    <>
      <PageHeader
        title="Countries"
        description="FIRINGI operates within the Schengen area. At launch wholesale customers and wholesalers are Portugal-only; distributors may be based in any EU Schengen country. Non-EU Schengen countries (NO, CH, IS, LI) open once customs handling exists; Cyprus and Ireland are outside Schengen."
      />
      <Table>
        <THead>
          <TR>
            <TH>Country</TH><TH>Area</TH><TH>VAT prefix</TH><TH>Currency</TH><TH>Languages</TH>
            <TH>Customers</TH><TH>Customers order</TH><TH>Wholesalers</TH><TH>Distributors</TH><TH className="text-right">Regions · Cities</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((c) => (
            <TR key={c.id}>
              <TD className="font-medium">{c.flag} {pickLocalized(c.name, locale)} <span className="text-xs text-muted-foreground">{c.code}</span></TD>
              <TD className="text-xs">{!c.isSchengen ? <span className="text-muted-foreground">Outside Schengen</span> : c.isEU ? "EU · Schengen" : "Schengen (non-EU)"}</TD>
              <TD><code className="text-xs">{c.vatPrefix}</code></TD>
              <TD>{c.defaultCurrencyCode}</TD>
              <TD className="text-xs">{c.languages.map((l) => l.language.native).join(", ")} + English</TD>
              <TD><On on={c.customerMarketEnabled} /></TD>
              <TD>{c.customerMarketEnabled ? <OrderModeSelect countryId={c.id} mode={c.customerOrderMode} canEdit={can(ctx, ["admin.international.manage", "admin.allocation.manage"])} /> : "—"}</TD>
              <TD><On on={c.wholesalerMarketEnabled} /></TD>
              <TD><On on={c.distributorSourcingEnabled} /></TD>
              <TD className="text-right tabular-nums">{c._count.regions} · {c._count.cities}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
