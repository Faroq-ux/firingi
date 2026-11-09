import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listRegions } from "@/server/data/geo";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Regions" };

export default async function RegionsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage"]);
  const [rows, locale] = await Promise.all([listRegions(ctx), getLocale()]);
  return (
    <>
      <PageHeader title="Regions" description="Regions marked with a tax region have their own VAT/IGIC rates (Madeira, Azores, Canary Islands)." />
      <Table>
        <THead><TR><TH>Country</TH><TH>Code</TH><TH>Region</TH><TH>Tax region</TH><TH className="text-right">Cities</TH></TR></THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>{r.country.flag} {r.country.code}</TD>
              <TD><code className="text-xs">{r.code}</code></TD>
              <TD className="font-medium">{pickLocalized(r.name, locale)}</TD>
              <TD>{r.taxRegionCode ? <Badge variant="warning">{r.taxRegionCode}</Badge> : "—"}</TD>
              <TD className="text-right tabular-nums">{r._count.cities}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
