import { CalendarRange } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { myEvents } from "@/server/planning/service";
import { offerOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EventForm, EventToggle } from "@/components/planning/vendor";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Demand events" };

export default async function Events() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [t, locale] = await Promise.all([getTranslations("planning"), getLocale()]);
  const [events, offers] = await Promise.all([myEvents(ctx), offerOptions(ctx, locale)]);
  const manage = can(ctx, "vendor.inventory.manage");
  const label = new Map(offers.map((o) => [o.id, o.label]));
  return (
    <>
      <PageHeader title={t("eventsPageTitle")} description={t("eventsIntro")} icon={CalendarRange} />
      {manage && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{t("newEvent")}</CardTitle><CardDescription>{t("newEventHint")}</CardDescription></CardHeader>
          <CardContent><EventForm offers={offers} /></CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-6">
          <DataTable tableId="vendor.planning.events" testId="events" empty={t("noEventsYet")}
            columns={[{ key: "name", label: t("eventName") }, { key: "by", label: t("col.by"), type: "badge", filter: true }, { key: "from", label: t("from"), type: "date" }, { key: "to", label: t("to"), type: "date" }, { key: "pct", label: t("effect"), type: "number" }, { key: "scope", label: t("products") }, { key: "act", label: "" }]}
            rows={events.map((e) => ({
              id: e.id,
              cells: {
                name: { t: e.name, sub: e.isActive ? undefined : t("off") }, by: { t: e.companyId ? t("byYou") : "FIRINGI", tone: e.companyId ? "outline" : "default" },
                from: { t: formatDate(e.startsOn, locale), v: e.startsOn.getTime() }, to: { t: formatDate(e.endsOn, locale), v: e.endsOn.getTime() },
                pct: { t: `${e.upliftPct > 0 ? "+" : ""}${e.upliftPct} %`, v: e.upliftPct, tone: e.upliftPct > 0 ? "success" : "warning" },
                scope: e.offerIds.length ? e.offerIds.map((id) => label.get(id) ?? "—").join(", ") : t("allProducts"),
                act: { t: "", node: manage && e.companyId ? <EventToggle id={e.id} active={e.isActive} /> : null },
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
