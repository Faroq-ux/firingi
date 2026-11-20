/** Drivers and vehicles tables (vendor fleet pages and FIRINGI fleet pages). */
import { getLocale, getTranslations } from "next-intl/server";
import type { ownFleet } from "@/server/services/fleet";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { DriverActiveToggle, VehicleStatusSelect } from "./delivery-forms";
import { FuelSelect } from "@/components/co2/client";
import { FUELS } from "@/lib/co2";

type Fleet = Awaited<ReturnType<typeof ownFleet>>;

export async function DriversTable({ drivers, manage, showOwner, ownerIsViewer = true }: { drivers: Fleet["drivers"]; manage: boolean; showOwner?: boolean; ownerIsViewer?: boolean }) {
  const [t, ta, ts, locale] = await Promise.all([getTranslations("delivery"), getTranslations("delivery.availabilityStatus"), getTranslations("accountStatus"), getLocale()]);
  return (
    <Table>
      <THead><TR><TH>{t("name")}</TH>{showOwner && <TH>{t("executor")}</TH>}<TH>{t("licenceNumber")}</TH><TH>{t("status")}</TH><TH>{t("availability")}</TH><TH className="text-right">{t("openDeliveries")}</TH>{manage && <TH />}</TR></THead>
      <TBody>
        {drivers.length === 0 && <EmptyRow colSpan={7}>{t("noDrivers")}</EmptyRow>}
        {drivers.map((d) => (
          <TR key={d.id}>
            <TD><div className="font-medium">{d.user.name}</div><div className="text-xs text-muted-foreground">{d.user.email}{d.user.phone ? ` · ${d.user.phone}` : ""}</div></TD>
            {showOwner && <TD className="text-xs">{d.owner.tradeName ?? d.owner.legalName}</TD>}
            <TD className="text-xs">{d.licenceNumber}{d.licenceExpiry ? ` · ${formatDate(d.licenceExpiry, locale)}` : ""}</TD>
            <TD><Badge variant={d.status === "APPROVED" ? "success" : d.status === "SUSPENDED" ? "destructive" : "secondary"}>{ts(d.status)}</Badge></TD>
            <TD className="text-xs">{ta(d.availability)}</TD>
            <TD className="text-right tabular-nums">{d._count.deliveries}</TD>
            {manage && <TD>{(d.status === "APPROVED" || d.status === "SUSPENDED") && (ownerIsViewer || d.status === "APPROVED") && <DriverActiveToggle id={d.id} active={d.status === "APPROVED"} />}</TD>}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export async function VehiclesTable({ vehicles, manage, showOwner, asFiringiOverVendor }: { vehicles: Fleet["vehicles"]; manage: boolean; showOwner?: boolean; asFiringiOverVendor?: (ownerId: string) => boolean }) {
  const [t, tt, tv, tf] = await Promise.all([getTranslations("delivery"), getTranslations("delivery.vehicleTypes"), getTranslations("delivery.vehicleStatus"), getTranslations("co2.fuel")]);
  const fuelLabels: Record<string, string> = { label: tf("label"), unknown: tf("unknown"), ...Object.fromEntries(FUELS.map((f) => [f, tf(f)])) };
  return (
    <Table>
      <THead><TR><TH>{t("plate")}</TH>{showOwner && <TH>{t("executor")}</TH>}<TH>{t("type")}</TH><TH>{t("make")}</TH><TH className="text-right">{t("capacityKg")}</TH><TH>{tf("label")}</TH><TH>{t("status")}</TH></TR></THead>
      <TBody>
        {vehicles.length === 0 && <EmptyRow colSpan={7}>{t("noVehicles")}</EmptyRow>}
        {vehicles.map((v) => {
          const overVendor = asFiringiOverVendor?.(v.ownerCompanyId) ?? false;
          return (
            <TR key={v.id}>
              <TD className="font-mono font-medium">{v.plate}{v.isRefrigerated ? " ❄" : ""}</TD>
              {showOwner && <TD className="text-xs">{v.owner.tradeName ?? v.owner.legalName}</TD>}
              <TD className="text-xs">{tt(v.type as never)}</TD>
              <TD className="text-xs">{[v.make, v.model].filter(Boolean).join(" ") || "—"}</TD>
              <TD className="text-right tabular-nums">{v.capacityKg ? Number(v.capacityKg) : "—"}</TD>
              <TD>{manage ? <FuelSelect vehicleId={v.id} fuel={v.fuel} labels={fuelLabels} /> : <span className="text-xs">{v.fuel ? fuelLabels[v.fuel] : "—"}</span>}</TD>
              <TD>{manage ? <VehicleStatusSelect id={v.id} status={v.status} statuses={overVendor ? ["ACTIVE", "INACTIVE"] : ["ACTIVE", "MAINTENANCE", "INACTIVE"]} needsReason={overVendor} /> : <Badge variant={v.status === "ACTIVE" ? "success" : "secondary"}>{tv(v.status)}</Badge>}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
