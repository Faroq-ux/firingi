import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listOwnServiceAreas, serviceAreaOptions } from "@/server/services/service-areas";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { AddAreaForm, RemoveAreaButton } from "@/components/delivery/delivery-forms";

export const metadata = { title: "Service areas" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.service_areas.manage", "vendor.fleet.view"]);
  const manage = can(ctx, "vendor.service_areas.manage");
  const [areas, opts, t, tt, locale] = await Promise.all([listOwnServiceAreas(ctx), manage ? serviceAreaOptions(ctx) : null, getTranslations("delivery"), getTranslations("delivery.areaTypes"), getLocale()]);
  const L = (v: unknown) => pickLocalized(v, locale);
  const describe = (a: (typeof areas)[number]) =>
    a.type === "COUNTRY" ? `${a.country.flag ?? ""} ${L(a.country.name)}`
    : a.type === "REGION" ? L(a.region?.name)
    : a.type === "CITY" ? a.city?.name ?? ""
    : a.type === "ZONE" ? a.zone?.name ?? ""
    : t("kmFrom", { km: Number(a.radiusKm), place: `${a.originAddress?.label ?? ""} (${a.originAddress?.cityName ?? ""})` });
  return (
    <>
      <PageHeader title={t("areas")} description={t("areasIntro")} />
      {opts && (
        <Card className="mb-4"><CardContent className="pt-5">
          <AddAreaForm
            ownCountryId={ctx.company.countryId} distributor={ctx.company.type === "DISTRIBUTOR"}
            countries={opts.countries.map((c) => ({ id: c.id, label: `${c.flag ?? ""} ${L(c.name)}` }))}
            regions={opts.regions.map((r) => ({ id: r.id, name: L(r.name), countryId: r.countryId }))}
            cities={opts.cities.map((c) => ({ id: c.id, name: c.name, countryId: c.countryId }))}
            zones={opts.zones.map((z) => ({ id: z.id, name: z.name, countryId: z.countryId }))}
            origins={opts.origins.map((o) => ({ id: o.id, name: `${o.label} (${o.cityName})` }))}
          />
        </CardContent></Card>
      )}
      <Card><CardContent className="pt-5">
        <Table>
          <THead><TR><TH>{t("areaType")}</TH><TH>{t("address")}</TH><TH /></TR></THead>
          <TBody>
            {areas.length === 0 && <EmptyRow colSpan={3}>{t("noAreas")}</EmptyRow>}
            {areas.map((a) => (
              <TR key={a.id}><TD>{tt(a.type)}</TD><TD>{describe(a)}</TD><TD className="text-right">{manage && <RemoveAreaButton id={a.id} />}</TD></TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
