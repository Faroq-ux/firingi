"use client";
/** Back-office allocation forms (English, FIRINGI staff). */
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions/_action";
import { assignPickupRunAction, dismissAllocationAction, manualMoveAction, runOverdueAction, saveVendorProfileAction, setCustomerOrderModeAction, updateAllocationRulesAction } from "@/server/actions/allocation";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, after?: (data: T) => void) =>
    start(async () => {
      setError(null); setSaved(false);
      const r = await fn();
      if (r.ok) { setSaved(true); after?.(r.data); router.refresh(); } else setError(r.error);
    });
  return { pending, error, saved, run };
}

export type RuleField = { path: string; label: string; help?: string; kind: "bool" | "number" | "select"; min?: number; max?: number; step?: number; suffix?: string; options?: { value: string; label: string }[] };

/** Edits part of the allocation rules; `path` is "a" or "a.b" inside the rules object. */
export function RulesForm({ fields, values, canEdit = true }: { fields: RuleField[]; values: Record<string, boolean | number | string>; canEdit?: boolean }) {
  const { pending, error, saved, run } = useAct();
  const [v, setV] = useState(values);
  const changed = fields.some((f) => v[f.path] !== values[f.path]);
  const save = () => {
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      const [a, b] = f.path.split(".");
      if (b) patch[a] = { ...((patch[a] as object) ?? {}), [b]: v[f.path] };
      else patch[a] = v[f.path];
    }
    run(() => updateAllocationRulesAction({ patch }));
  };
  return (
    <div className="space-y-3 text-sm" data-testid="rules-form">
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        {fields.map((f) => (
          <div key={f.path} className="rounded-md border p-3">
            {f.kind === "select" ? (
              <label className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{f.label}</span>{f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}</span>
                <select name={f.path} className="h-9 rounded-md border bg-card px-2 text-sm" value={String(v[f.path] ?? "")} onChange={(e) => setV({ ...v, [f.path]: e.target.value })}>
                  {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ) : f.kind === "bool" ? (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" name={f.path} checked={!!v[f.path]} onChange={(e) => setV({ ...v, [f.path]: e.target.checked })} />
                <span><span className="font-medium">{f.label}</span>{f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}</span>
              </label>
            ) : (
              <label className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{f.label}</span>{f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}</span>
                <span className="flex items-center gap-1.5">
                  <Input type="number" name={f.path} className="w-28 text-right" min={f.min} max={f.max} step={f.step ?? 1} value={String(v[f.path] ?? "")}
                    onChange={(e) => setV({ ...v, [f.path]: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })} />
                  {f.suffix && <span className="text-muted-foreground">{f.suffix}</span>}
                </span>
              </label>
            )}
          </div>
        ))}
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button disabled={pending || !changed} onClick={save}>Save</Button>
          {saved && !changed && <span className="text-success">Saved</span>}
          {error && <span className="text-destructive" role="alert">{error}</span>}
        </div>
      )}
    </div>
  );
}

export function CountryDistanceForm({ countries, values, fallback }: { countries: { id: string; label: string }[]; values: Record<string, number>; fallback: number }) {
  const { pending, error, saved, run } = useAct();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(countries.map((c) => [c.id, values[c.id] ? String(values[c.id]) : ""])));
  const save = () => run(() => updateAllocationRulesAction({ patch: { countryDistanceKm: Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== "").map(([k, x]) => [k, Number(x)])) } }));
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {countries.map((c) => (
          <label key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <span>{c.label}</span>
            <span className="flex items-center gap-1"><Input type="number" min={1} max={1000} className="w-24 text-right" placeholder={String(fallback)} value={v[c.id]} name={`country-${c.id}`} onChange={(e) => setV({ ...v, [c.id]: e.target.value })} /> km</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={save}>Save country limits</Button>
        {saved && <span className="text-success">Saved</span>}
        {error && <span className="text-destructive" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/** Inline editor for one supplier's allocation profile (only the fields asked for). */
export function VendorProfileForm({ companyId, priority, excluded, capacity, note, show }: {
  companyId: string; priority: number; excluded: boolean; capacity: number | null; note: string | null; show: ("priority" | "excluded" | "capacity" | "note")[];
}) {
  const { pending, error, saved, run } = useAct();
  const [f, setF] = useState({ priority: String(priority), excluded, capacity: capacity === null ? "" : String(capacity), note: note ?? "" });
  const save = () => run(() => saveVendorProfileAction({
    companyId,
    ...(show.includes("priority") ? { priority: Number(f.priority) } : {}),
    ...(show.includes("excluded") ? { excluded: f.excluded } : {}),
    ...(show.includes("capacity") ? { dailyOrderCapacity: f.capacity.trim() === "" ? null : Number(f.capacity) } : {}),
    ...(show.includes("note") ? { note: f.note } : {}),
  }));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`profile-${companyId}`}>
      {show.includes("priority") && <Input aria-label="Priority" name="priority" type="number" min={0} max={100} className="w-20 text-right" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} />}
      {show.includes("capacity") && <Input aria-label="Orders per day" name="capacity" type="number" min={1} placeholder="no limit" className="w-28 text-right" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />}
      {show.includes("excluded") && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="excluded" checked={f.excluded} onChange={(e) => setF({ ...f, excluded: e.target.checked })} />Exclude</label>}
      {show.includes("note") && <Input aria-label="Note" name="note" className="w-48" placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}
      <Button size="sm" variant="outline" disabled={pending} onClick={save}>Save</Button>
      {saved && <span className="text-xs text-success">Saved</span>}
      {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
    </div>
  );
}

export function MoveButton({ orderId, vendorId, vendorName, marginOnly }: { orderId: string; vendorId: string; vendorName: string; marginOnly: boolean }) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<{ orderId: string; number: string }[] | null>(null);
  if (result) return <span className="text-sm text-success">Moved → {result.map((r) => <Link key={r.orderId} className="underline" href={`/admin/orders/${r.orderId}`}>{r.number}</Link>)}</span>;
  if (!open) return <Button size="sm" variant={marginOnly ? "outline" : "default"} onClick={() => setOpen(true)}>Move here</Button>;
  return (
    <div className="space-y-2 rounded-md border bg-card p-2 text-sm">
      <div>Move to <b>{vendorName}</b>?</div>
      <Input name="moveNote" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {marginOnly && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="override" checked={override} onChange={(e) => setOverride(e.target.checked)} />Accept the margin below the floor</label>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || (marginOnly && !override)} onClick={() => run(() => manualMoveAction({ orderId, vendorId, marginOverride: override, note: note || null }), (d) => setResult(d.newOrders))}>Confirm move</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

export function DismissButton({ eventId }: { eventId: string }) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Close case</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input name="dismissNote" className="w-56" placeholder="Why? (e.g. buyer will reorder)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => run(() => dismissAllocationAction({ eventId, note }))}>Close</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function RunNowButton() {
  const { pending, error, run } = useAct();
  const [res, setRes] = useState<{ checked: number; moved: number; waiting: number } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Button variant="outline" disabled={pending} onClick={() => run(() => runOverdueAction({}), setRes)}>Check unanswered orders now</Button>
      {res && <span data-testid="run-result">{res.checked} overdue · {res.moved} moved · {res.waiting} waiting for a decision</span>}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}

export function OrderModeSelect({ countryId, mode, canEdit }: { countryId: string; mode: "CHOOSE_SUPPLIER" | "FIRINGI"; canEdit: boolean }) {
  const { pending, error, saved, run } = useAct();
  const [m, setM] = useState(mode);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select name={`mode-${countryId}`} className="h-8 rounded-md border bg-card px-2 text-sm" disabled={!canEdit || pending} value={m}
        onChange={(e) => { const next = e.target.value as typeof m; setM(next); run(() => setCustomerOrderModeAction({ countryId, mode: next })); }}>
        <option value="CHOOSE_SUPPLIER">Customers choose the wholesaler</option>
        <option value="FIRINGI">Customers order from FIRINGI</option>
      </select>
      {saved && <span className="text-xs text-success">Saved</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** Small FIRINGI-fleet orders at one pickup point → one driver collects them all. */
export function PickupRunForm({ deliveryIds, drivers }: { deliveryIds: string[]; drivers: { id: string; name: string }[] }) {
  const { pending, error, saved, run } = useAct();
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "");
  if (!drivers.length) return <span className="text-xs text-muted-foreground">No FIRINGI driver available.</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select name="driver" className="h-8 rounded-md border bg-card px-2 text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <Button size="sm" disabled={pending || !driverId} onClick={() => run(() => assignPickupRunAction({ deliveryIds, driverId }))}>Assign all ({deliveryIds.length})</Button>
      {saved && <span className="text-xs text-success">Assigned</span>}
      {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
    </span>
  );
}
