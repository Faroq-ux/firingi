import { CalendarRange } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canAdminManagePlanning, eventOptions, globalEvents } from "@/server/planning/service";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { GlobalEventForm, GlobalEventToggle } from "@/components/planning/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Demand Events" };

export default async function Events() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const [events, { countries, categories, supplierEvents }] = await Promise.all([globalEvents(ctx), eventOptions(ctx)]);
  const manage = canAdminManagePlanning(ctx);
  const cat = new Map(categories.map((c) => [c.id, pickLocalized(c.name as never, "en")]));
  const country = new Map(countries.map((c) => [c.id, c.code]));
  return (
    <>
      <PageHeader title="Demand Events" icon={CalendarRange} description={`Holidays and seasons that move demand for every supplier (or one country / category). Suppliers add their own promotions on top (${supplierEvents} active now). Event weeks are taken out of the history before the forecast learns from it, and put back into the forecast.`} />
      {manage && (
        <Card className="mb-6">
          <CardHeader><CardTitle>New event</CardTitle><CardDescription>+40 % = 40 % more demand while it lasts; −20 % = 20 % less.</CardDescription></CardHeader>
          <CardContent><GlobalEventForm countries={countries.map((c) => ({ id: c.id, label: `${c.code} · ${pickLocalized(c.name as never, "en")}` }))} categories={categories.map((c) => ({ id: c.id, label: `${c.depth ? "— " : ""}${pickLocalized(c.name as never, "en")}` }))} /></CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-6">
          <DataTable tableId="admin.planning.events" testId="global-events" empty="No events."
            columns={[{ key: "name", label: "Event" }, { key: "from", label: "From", type: "date" }, { key: "to", label: "To", type: "date" }, { key: "pct", label: "Effect", type: "number" }, { key: "where", label: "Where" }, { key: "what", label: "Products" }, { key: "state", label: "State", type: "badge", filter: true }, { key: "act", label: "" }]}
            rows={events.map((e) => ({
              id: e.id,
              cells: {
                name: e.name, from: { t: formatDate(e.startsOn, "en"), v: e.startsOn.getTime() }, to: { t: formatDate(e.endsOn, "en"), v: e.endsOn.getTime() },
                pct: { t: `${e.upliftPct > 0 ? "+" : ""}${e.upliftPct} %`, v: e.upliftPct, tone: e.upliftPct > 0 ? "success" : "warning" },
                where: e.countryId ? country.get(e.countryId) ?? "—" : "All countries", what: e.categoryIds.length ? e.categoryIds.map((c) => cat.get(c) ?? "—").join(", ") : "All products",
                state: { t: e.isActive ? "on" : "off", tone: e.isActive ? "success" : "outline" },
                act: { t: "", node: manage ? <GlobalEventToggle id={e.id} active={e.isActive} /> : null },
              },
            }))} />
        </CardContent>
      </Card>
    </>
  );
}
