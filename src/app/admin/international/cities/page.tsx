import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCities } from "@/server/data/geo";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Cities" };

export default async function CitiesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage"]);
  const [rows, locale] = await Promise.all([listCities(ctx), getLocale()]);
  return (
    <>
      <PageHeader title="Cities" description="City coordinates are used for distance-based (km radius) service areas." />
      <Table>
        <THead><TR><TH>Country</TH><TH>Region</TH><TH>City</TH><TH className="text-right">Coordinates</TH></TR></THead>
        <TBody>
          {rows.map((c) => (
            <TR key={c.id}>
              <TD>{c.country.flag} {c.country.code}</TD>
              <TD>{pickLocalized(c.region.name, locale)}</TD>
              <TD className="font-medium">{c.name}</TD>
              <TD className="text-right font-mono text-xs">{c.latitude?.toString()}, {c.longitude?.toString()}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
