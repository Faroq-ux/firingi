"use client";
/** Route planning and route controls — used by FIRINGI (English) and vendors (translated labels). */
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions/_action";
import {
  autoPlanAction, cancelRouteAction, createRouteAction, moveStopAction, removeFromRouteAction, reoptimiseRouteAction, setRoutingSettingsAction, startRouteAction,
} from "@/server/actions/routes";

type Labels = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

/** Server errors that have a translated text (the vendor portal is translated; FIRINGI's is English). */
function errText(r: { code?: string; error: string }, l?: Labels) {
  if (r.code === "DRIVER_FULL" && l?.driverFullOne) {
    const m = /at most (\d+) orders.*already has (\d+)/.exec(r.error);
    return m ? fill(l.driverFullMax, { max: m[1], open: m[2] }) : l.driverFullOne;
  }
  return r.error;
}

function useAct(l?: Labels) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, after?: (data: T) => string | void) =>
    start(async () => {
      setError(null); setMsg(null);
      const r = await fn();
      if (r.ok) { setMsg(after?.(r.data) || null); router.refresh(); } else setError(errText(r as { code?: string; error: string }, l));
    });
  return { pending, error, msg, run };
}

export type WaitingRow = { id: string; number: string; buyer: string; supplier: string; pickup: string; city: string; region: string; requested: string | null; status: string };

/** Pick deliveries + driver (+ vehicle) and create a route; or plan the whole day automatically. */
export function PlanRouteForm({ rows, drivers, vehicles, today, l, routeBase }: {
  rows: WaitingRow[]; drivers: { id: string; name: string; availability: string }[]; vehicles: { id: string; plate: string }[]; today: string; l: Labels; routeBase: string;
}) {
  const { pending, error, msg, run } = useAct(l);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(today);
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "");
  const [vehicleId, setVehicleId] = useState("");
  const [created, setCreated] = useState<{ id: string; number: string } | null>(null);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = rows.length > 0 && sel.size === rows.length;
  const byCity = useMemo(() => [...rows].sort((a, b) => a.city.localeCompare(b.city)), [rows]);
  return (
    <div className="space-y-3 text-sm" data-testid="plan-route">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="block text-xs text-muted-foreground">{l.date}</span><Input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" /></label>
        <label className="space-y-1"><span className="block text-xs text-muted-foreground">{l.driver}</span>
          <select name="driverId" className="h-9 rounded-md border bg-card px-2" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.availability === "OFF_DUTY" ? ` (${l.offDuty})` : ""}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="block text-xs text-muted-foreground">{l.vehicle}</span>
          <select name="vehicleId" className="h-9 rounded-md border bg-card px-2" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">{l.noVehicle}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
        </label>
        <Button disabled={pending || !sel.size || !driverId} onClick={() => run(() => createRouteAction({ date, driverId, vehicleId: vehicleId || null, deliveryIds: [...sel] }), (r) => { setSel(new Set()); setCreated(r); return fill(l.created, { number: r.number }); })}>
          {l.create}{sel.size ? ` (${sel.size})` : ""}
        </Button>
        <Button variant="outline" disabled={pending || !rows.length} onClick={() => run(() => autoPlanAction({ date }), (r) => fill(l.autoPlanned, { planned: r.planned, routes: r.routes.length, left: r.left }))}>{l.autoPlan}</Button>
      </div>
      {(msg || error) && (
        <p role={error ? "alert" : "status"} className={error ? "text-destructive" : "text-success"}>
          {error ?? msg}{!error && created && <> · <Link className="text-primary hover:underline" href={`${routeBase}/${created.id}`}>{created.number}</Link></>}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 p-2"><input type="checkbox" aria-label="all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th className="p-2">{l.order}</th><th className="p-2">{l.customer}</th><th className="p-2">{l.city}</th><th className="p-2">{l.pickupAt}</th><th className="p-2">{l.requested}</th>
            </tr>
          </thead>
          <tbody>
            {byCity.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2"><input type="checkbox" aria-label={r.number} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="p-2 font-medium">{r.number}</td><td className="p-2">{r.buyer}</td><td className="p-2">{r.city}{r.region !== "—" ? <span className="text-xs text-muted-foreground"> · {r.region}</span> : null}</td>
                <td className="p-2">{r.pickup}<span className="block text-xs text-muted-foreground">{r.supplier}</span></td><td className="p-2">{r.requested ?? "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">{l.noWaiting}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Re-optimise / cancel / start for a route (dispatcher). */
export function RouteActions({ id, status, l }: { id: string; status: string; l: Labels }) {
  const { pending, error, msg, run } = useAct();
  const open = status === "PLANNED" || status === "IN_PROGRESS";
  if (!open) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button variant="outline" disabled={pending} onClick={() => run(() => reoptimiseRouteAction({ id }), (r) => fill(l.reoptimised, { before: r.beforeKm.toFixed(1), after: r.afterKm.toFixed(1) }))}>{l.reoptimise}</Button>
      {status === "PLANNED" && <Button disabled={pending} onClick={() => run(() => startRouteAction({ id }))}>{l.startRoute}</Button>}
      {status === "PLANNED" && <Button variant="outline" disabled={pending} onClick={() => { if (confirm(l.cancelConfirm)) run(() => cancelRouteAction({ id })); }}>{l.cancel}</Button>}
      {msg && <span className="text-success" role="status">{msg}</span>}
      {error && <span className="text-destructive" role="alert">{error}</span>}
    </div>
  );
}

/** Up / down / take off route for one stop. */
export function StopControls({ routeId, stopId, deliveryId, up, down, remove, l }: { routeId: string; stopId: string; deliveryId: string; up: boolean; down: boolean; remove: boolean; l: Labels }) {
  const { pending, error, run } = useAct();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" className="rounded border px-1.5 disabled:opacity-30" disabled={pending || !up} title={l.up} aria-label={l.up} onClick={() => run(() => moveStopAction({ routeId, stopId, dir: -1 }))}>↑</button>
      <button type="button" className="rounded border px-1.5 disabled:opacity-30" disabled={pending || !down} title={l.down} aria-label={l.down} onClick={() => run(() => moveStopAction({ routeId, stopId, dir: 1 }))}>↓</button>
      {remove && <button type="button" className="rounded border px-1.5 text-xs disabled:opacity-30" disabled={pending} onClick={() => run(() => removeFromRouteAction({ routeId, deliveryId }))}>{l.remove}</button>}
      {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
    </span>
  );
}

/** Driver's "Start route" button. */
export function StartRouteButton({ id, label }: { id: string; label: string }) {
  const { pending, error, run } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <Button disabled={pending} onClick={() => run(() => startRouteAction({ id }))}>{label}</Button>
      {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
    </span>
  );
}

export type RoutingValues = { avgSpeedKmh: number; roadFactor: number; pickupMinutes: number; dropMinutes: number; startTime: string; depotAddressId: string | null; etaWindowMinutes: number; pay: { perRoute: number; perDelivery: number; perKm: number }; vehicleCostPerKm: number };

/** FIRINGI's routing settings (English back office). `only` limits which fields show. */
export function RoutingSettingsForm({ values, depots, canEdit, only }: { values: RoutingValues; depots: { id: string; label: string }[]; canEdit: boolean; only?: ("plan" | "eta" | "pay")[] }) {
  const { pending, error, msg, run } = useAct();
  const [v, setV] = useState(values);
  const show = (k: "plan" | "eta" | "pay") => !only || only.includes(k);
  const num = (k: keyof RoutingValues, label: string, help: string, step = 1, suffix = "") => (
    <label className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{help}</span></span>
      <span className="flex items-center gap-1.5"><Input type="number" name={k} step={step} className="w-28 text-right" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />{suffix && <span className="text-muted-foreground">{suffix}</span>}</span>
    </label>
  );
  const pay = (k: keyof RoutingValues["pay"], label: string) => (
    <label className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-1.5"><Input type="number" name={`pay.${k}`} step={0.01} className="w-28 text-right" value={String(v.pay[k])} onChange={(e) => setV({ ...v, pay: { ...v.pay, [k]: Number(e.target.value) } })} /><span className="text-muted-foreground">€</span></span>
    </label>
  );
  return (
    <div className="space-y-3 text-sm" data-testid="routing-settings">
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        {show("plan") && <>
          <label className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <span><span className="font-medium">Depot</span><span className="block text-xs text-muted-foreground">Where FIRINGI routes start.</span></span>
            <select name="depotAddressId" className="h-9 rounded-md border bg-card px-2" value={v.depotAddressId ?? ""} onChange={(e) => setV({ ...v, depotAddressId: e.target.value || null })}>
              <option value="">First FIRINGI warehouse</option>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <span><span className="font-medium">Route start time</span><span className="block text-xs text-muted-foreground">Planned departure from the depot (Lisbon time).</span></span>
            <Input type="time" name="startTime" className="w-32" value={v.startTime} onChange={(e) => setV({ ...v, startTime: e.target.value })} />
          </label>
          {num("avgSpeedKmh", "Average speed", "Used for driving times between stops.", 1, "km/h")}
          {num("roadFactor", "Road factor", "Straight-line distance × this factor ≈ road distance (1.3 in towns).", 0.05, "×")}
          {num("pickupMinutes", "Time per pickup", "Loading at the supplier.", 1, "min")}
          {num("dropMinutes", "Time per delivery", "Unloading and signature at the customer.", 1, "min")}
        </>}
        {show("eta") && num("etaWindowMinutes", "Customer time window", "Customers are told: expected between ETA − half and ETA + half of this window. A stop is late when it runs past the window.", 5, "min")}
        {show("pay") && <>{pay("perRoute", "Pay per completed route")}{pay("perDelivery", "Pay per delivered order")}{pay("perKm", "Pay per planned km")}{num("vehicleCostPerKm", "Vehicle cost per km", "Fuel and wear of a FIRINGI vehicle — used for route profitability.", 0.01, "€")}</>}
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={() => run(() => setRoutingSettingsAction({ patch: v as unknown as Record<string, unknown> }), () => "Saved")}>Save</Button>
          {msg && <span className="text-success" role="status">{msg}</span>}
          {error && <span className="text-destructive" role="alert">{error}</span>}
        </div>
      )}
    </div>
  );
}
