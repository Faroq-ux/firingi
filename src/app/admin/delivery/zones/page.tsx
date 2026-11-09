import { getLocale } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listAllServiceAreas, listZones } from "@/server/services/service-areas";
import { listCountries } from "@/server/data/geo";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ZoneActiveToggle, ZoneForm } from "@/components/admin/delivery-admin-forms";

export const metadata = { title: "Delivery Zones" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage", "admin.international.view"]);
  const manage = can(ctx, "admin.delivery.manage");
  const [zones, areas, countries, locale] = await Promise.all([listZones(ctx), listAllServiceAreas(ctx), listCountries(ctx), getLocale()]);
  const opts = countries.filter((c) => c.isActive).map((c) => ({ code: c.code, label: `${c.flag ?? ""} ${pickLocalized(c.name, locale)}` }));
  const L = (v: unknown) => pickLocalized(v, locale);
  return (
    <>
      <PageHeader title="Delivery Zones" description="Zones are defined by postal-code patterns and/or a map polygon (PostGIS). Vendors pick zones as service areas; an address is inside a zone if its postal code matches or its location lies within the polygon." actions={manage ? <ZoneForm countries={opts} /> : undefined} />
      <Card className="mb-4"><CardContent className="pt-5">
        <Table>
          <THead><TR><TH>Zone</TH><TH>Postal codes</TH><TH>Map area</TH><TH className="text-right">Vendors using it</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>
            {zones.length === 0 && <EmptyRow colSpan={6}>No zones yet.</EmptyRow>}
            {zones.map((z) => (
              <TR key={z.id}>
                <TD><span className="font-medium">{z.country.flag} {z.name}</span></TD>
                <TD className="max-w-64 text-xs">{z.postalCodePatterns.join(", ") || "—"}</TD>
                <TD className="text-xs">{z.areaKm2 != null ? `${z.areaKm2.toLocaleString(locale, { maximumFractionDigits: 1 })} km²` : "—"}</TD>
                <TD className="text-right tabular-nums">{z._count.serviceAreas}</TD>
                <TD><Badge variant={z.isActive ? "success" : "secondary"}>{z.isActive ? "active" : "inactive"}</Badge></TD>
                <TD className="space-x-1 text-right">{manage && (<><ZoneForm countries={opts} zone={{ id: z.id, countryCode: z.country.code, name: z.name, patterns: z.postalCodePatterns, polygon: z.polygon ? JSON.stringify(z.polygon) : "" }} /><ZoneActiveToggle id={z.id} active={z.isActive} /></>)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Vendor service areas</CardTitle></CardHeader><CardContent>
        <Table>
          <THead><TR><TH>Vendor</TH><TH>Type</TH><TH>Area</TH></TR></THead>
          <TBody>
            {areas.length === 0 && <EmptyRow colSpan={3}>No vendor restricts its area — every vendor sells in its whole market.</EmptyRow>}
            {areas.map((a) => (
              <TR key={a.id}>
                <TD className="font-medium">{a.vendor.legalName}</TD>
                <TD className="text-xs">{a.type.replace("_", " ").toLowerCase()}</TD>
                <TD className="text-xs">{a.type === "COUNTRY" ? `${a.country.flag} ${L(a.country.name)}` : a.type === "REGION" ? L(a.region?.name) : a.type === "CITY" ? a.city?.name : a.type === "ZONE" ? a.zone?.name : `${Number(a.radiusKm)} km around ${a.originAddress?.label} (${a.originAddress?.cityName})`}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
