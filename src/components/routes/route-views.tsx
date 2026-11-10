/** Route views shared by FIRINGI (English back office), vendors and drivers (translated). */
import Link from "next/link";
import type { RouteStatus } from "@prisma/client";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { listRoutes, plannableDeliveries, routeDetail, routeDrivers, routingSettings } from "@/server/services/routes";
import { mapsLink } from "@/server/delivery/routing";
import en from "@/messages/en.json";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { PlanRouteForm, RouteActions, StartRouteButton, StopControls } from "./route-forms";

const VARIANT: Record<RouteStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = { PLANNED: "warning", IN_PROGRESS: "default", COMPLETED: "success", CANCELLED: "secondary" };
type Msgs = typeof en.routes;

/** Route texts: English for the back office, the user's language elsewhere. */
export async function routeLabels(english: boolean) {
  if (english) return { l: en.routes as Msgs, locale: "en" };
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...en.routes, ...((m as { routes?: Partial<Msgs> }).routes ?? {}) } as Msgs, locale };
}
/** Flat string labels for client components. */
const flat = (l: Msgs) => Object.fromEntries(Object.entries(l).filter(([, v]) => typeof v === "string")) as Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

/** Clock time in Lisbon. */
export const hm = (d: Date | null | undefined, locale = "pt-PT") => (d ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(d) : "—");
export const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);

export function RouteStatusBadge({ status, l }: { status: RouteStatus; l: Msgs }) {
  return <Badge variant={VARIANT[status]}>{l.statuses[status]}</Badge>;
}

type Rows = Awaited<ReturnType<typeof listRoutes>>;
export function RoutesTable({ rows, base, l, locale, showExecutor }: { rows: Rows; base: string; l: Msgs; locale: string; showExecutor?: boolean }) {
  return (
    <Table data-testid="routes-table">
      <THead><TR><TH>{l.number}</TH><TH>{l.date}</TH><TH>{l.driver}</TH>{showExecutor && <TH>Fleet</TH>}<TH>{l.stops}</TH><TH>{l.progress}</TH><TH className="text-right">{l.distance}</TH><TH className="text-right">{l.duration}</TH><TH>{l.plannedStart}</TH><TH>{l.status}</TH></TR></THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD><Link className="font-medium text-primary hover:underline" href={`${base}/${r.id}`}>{r.number}</Link></TD>
            <TD>{formatDate(r.date, locale)}</TD>
            <TD>{r.driver}{r.vehicle ? <span className="text-xs text-muted-foreground"> · {r.vehicle}</span> : null}</TD>
            {showExecutor && <TD>{r.executor}</TD>}
            <TD>{r.pickups} ↑ · {r.drops} ↓</TD>
            <TD className="tabular-nums">{r.done}/{r.total}{r.late > 0 && <span className="ml-1 text-xs text-destructive">{fill(l.late, { count: r.late })}</span>}</TD>
            <TD className="text-right tabular-nums">{r.plannedKm.toFixed(1)} km</TD>
            <TD className="text-right tabular-nums">{dur(r.plannedMinutes)}</TD>
            <TD className="tabular-nums">{hm(r.startedAt ?? r.plannedStartAt, locale)}</TD>
            <TD><RouteStatusBadge status={r.status} l={l} /></TD>
          </TR>
        ))}
        {!rows.length && <EmptyRow colSpan={showExecutor ? 10 : 9}>{l.empty}</EmptyRow>}
      </TBody>
    </Table>
  );
}

/** Deliveries waiting for a route + the planning form (dispatcher). */
export async function PlanPanel({ ctx, english, routeBase }: { ctx: Ctx; english: boolean; routeBase: string }) {
  const [{ l, locale }, rows, fleet] = await Promise.all([routeLabels(english), plannableDeliveries(ctx), routeDrivers(ctx)]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <CardHeader><CardTitle>{l.plan} · {l.waiting} ({rows.length})</CardTitle></CardHeader>
      <CardContent>
        <PlanRouteForm
          rows={rows.map((r) => ({ id: r.id, number: r.number, buyer: r.buyer, supplier: r.supplier, pickup: r.pickup, city: r.city, region: r.region, requested: r.requested ? formatDate(r.requested, locale) : null, status: r.status }))}
          drivers={fleet.drivers} vehicles={fleet.vehicles} today={today} l={flat(l)} routeBase={routeBase}
        />
        {!fleet.drivers.length && <p className="mt-2 text-xs text-muted-foreground">{english ? "Add and approve a driver first." : ""}</p>}
      </CardContent>
    </Card>
  );
}

/** One route: header facts, ordered stops with ETAs, controls. */
export async function RouteDetail({ ctx, id, english, deliveryHref }: { ctx: Ctx; id: string; english: boolean; deliveryHref: (orderId: string) => string }) {
  const [{ l, locale }, { route: r, canManage }] = await Promise.all([routeLabels(english), routeDetail(ctx, id)]);
  const open = r.status === "PLANNED" || r.status === "IN_PROGRESS";
  const remaining = r.stops.filter((s) => !s.doneAt);
  const maps = mapsLink(remaining.map((s) => ({ lat: s.lat === null ? null : Number(s.lat), lng: s.lng === null ? null : Number(s.lng), address: s.address })));
  const settings = await routingSettings();
  const lateMs = (settings.etaWindowMinutes / 2) * 60_000;
  return (
    <div className="space-y-4" data-testid="route-detail">
      <Card>
        <CardContent className="grid gap-3 pt-5 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div><div className="text-muted-foreground">{l.status}</div><RouteStatusBadge status={r.status} l={l} /></div>
          <div><div className="text-muted-foreground">{l.date}</div>{formatDate(r.date, locale)}</div>
          <div><div className="text-muted-foreground">{l.driver}</div>{r.driver?.user.name ?? "—"}{r.vehicle ? ` · ${r.vehicle.plate}` : ""}</div>
          <div><div className="text-muted-foreground">{l.plannedStart}</div>{hm(r.plannedStartAt, locale)}{r.startLabel ? <span className="text-xs text-muted-foreground"> · {r.startLabel}</span> : null}</div>
          <div><div className="text-muted-foreground">{l.distance}</div>{Number(r.plannedKm).toFixed(1)} km</div>
          <div><div className="text-muted-foreground">{l.duration}</div>{dur(r.plannedMinutes)}</div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        {canManage && <RouteActions id={r.id} status={r.status} l={flat(l)} />}
        {open && maps && <a className="text-sm text-primary hover:underline" href={maps} target="_blank" rel="noreferrer">{l.openMaps} ↗</a>}
      </div>
      <Card>
        <CardHeader><CardTitle>{l.stops} ({r.stops.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>#</TH><TH>{l.status}</TH><TH>{l.order}</TH><TH>{l.customer} / {l.supplier}</TH><TH>{l.eta}</TH><TH>{l.doneAt}</TH>{canManage && open && <TH />}</TR></THead>
            <TBody>
              {r.stops.map((s, i) => {
                const late = !s.doneAt && s.eta && s.plannedArrival && s.eta.getTime() - s.plannedArrival.getTime() > lateMs;
                const prevDone = i === 0 || !!r.stops[i - 1].doneAt;
                return (
                  <TR key={s.id} data-testid="route-stop" className={s.doneAt ? "text-muted-foreground" : ""}>
                    <TD className="tabular-nums">{i + 1}</TD>
                    <TD><Badge variant={s.kind === "PICKUP" ? "secondary" : "default"}>{s.kind === "PICKUP" ? l.pickup : l.drop}</Badge></TD>
                    <TD><Link className="text-primary hover:underline" href={deliveryHref(s.delivery.order.id)}>{s.delivery.order.number}</Link></TD>
                    <TD><div className="font-medium">{s.label}</div><div className="text-xs text-muted-foreground">{s.address}</div></TD>
                    <TD className="tabular-nums">{hm(s.eta, locale)}{late && <span className="ml-1 text-destructive" title={fill(l.late, { count: 1 })}>⚠</span>}</TD>
                    <TD className="tabular-nums">{s.doneAt ? `✓ ${hm(s.doneAt, locale)}` : "—"}</TD>
                    {canManage && open && (
                      <TD>{!s.doneAt && <StopControls routeId={r.id} stopId={s.id} deliveryId={s.deliveryId} up={i > 0 && !prevDone} down={i < r.stops.length - 1} remove={s.kind === "DROP" && s.delivery.status === "ASSIGNED"} l={flat(l)} />}</TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Routes list with Open / History tabs. */
export async function RoutesList({ ctx, english, base, tab, all }: { ctx: Ctx; english: boolean; base: string; tab: "open" | "history"; all?: boolean }) {
  const { l, locale } = await routeLabels(english);
  const rows = (await listRoutes(ctx, { all })).filter((r) => (tab === "open" ? r.status === "PLANNED" || r.status === "IN_PROGRESS" : r.status === "COMPLETED" || r.status === "CANCELLED"));
  return <RoutesTable rows={rows} base={base} l={l} locale={locale} showExecutor={all} />;
}

/** Driver: the open route(s) with start button, next stop and the ordered stop list. */
export async function DriverRoutes({ routes }: { routes: Awaited<ReturnType<typeof import("@/server/services/routes").myRoutes>> }) {
  if (!routes.length) return null;
  const [{ l, locale }, td] = await Promise.all([routeLabels(false), getTranslations("delivery.statuses")]);
  return (
    <div className="mb-4 space-y-4">
      {routes.map((r) => {
        const remaining = r.stops.filter((s) => !s.doneAt);
        const maps = mapsLink(remaining.map((s) => ({ lat: s.lat === null ? null : Number(s.lat), lng: s.lng === null ? null : Number(s.lng), address: s.address })));
        const next = remaining[0];
        return (
          <Card key={r.id} data-testid="driver-route">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>{l.myRoute} {r.number} · {formatDate(r.date, locale)}</span><RouteStatusBadge status={r.status} l={l} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                {r.status === "PLANNED" && <StartRouteButton id={r.id} label={l.startRoute} />}
                {maps && <a className="text-primary hover:underline" href={maps} target="_blank" rel="noreferrer">{l.openMaps} ↗</a>}
                <span className="text-muted-foreground">{Number(r.plannedKm).toFixed(1)} km · {dur(r.plannedMinutes)}{r.vehicle ? ` · ${r.vehicle.plate}` : ""}</span>
              </div>
              {r.status === "PLANNED" && <p className="text-xs text-muted-foreground">{l.startHint}</p>}
              {next && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                  <div className="text-xs text-muted-foreground">{l.nextStop} · {hm(next.eta, locale)}</div>
                  <div className="font-medium">{next.kind === "PICKUP" ? l.pickup : l.drop}: {next.label}</div>
                  <div className="text-muted-foreground">{next.address}</div>
                  <Link className="text-primary hover:underline" href={`/driver/deliveries/${next.delivery.id}`}>{next.delivery.order.number} →</Link>
                </div>
              )}
              <ol className="space-y-1">
                {r.stops.map((s, i) => (
                  <li key={s.id} className={`flex flex-wrap items-baseline gap-2 ${s.doneAt ? "text-muted-foreground line-through" : ""}`} data-testid="driver-stop">
                    <span className="w-5 tabular-nums">{i + 1}.</span>
                    <span className="w-12 tabular-nums">{s.doneAt ? "✓" : hm(s.eta, locale)}</span>
                    <span>{s.kind === "PICKUP" ? "↑" : "↓"} {s.label}</span>
                    <Link className="text-xs text-primary hover:underline" href={`/driver/deliveries/${s.delivery.id}`}>{s.delivery.order.number}</Link>
                    <span className="text-xs text-muted-foreground">{td(s.delivery.status)}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** Customer: the delivery window around the ETA (only while the order is on its way today). */
export async function EtaWindow({ eta, status }: { eta: Date | null; status: string }) {
  if (!eta || !["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"].includes(status)) return null;
  const [{ l, locale }, s] = await Promise.all([routeLabels(false), routingSettings()]);
  const half = (s.etaWindowMinutes / 2) * 60_000;
  return (
    <div data-testid="eta-window" className="rounded-md border border-primary/40 bg-primary/5 p-2">
      {fill(l.deliveryWindow, { from: hm(new Date(eta.getTime() - half), locale), to: hm(new Date(eta.getTime() + half), locale) })}
      <span className="text-muted-foreground"> · {formatDate(eta, locale)}</span>
    </div>
  );
}
