"use client";
/** Back-office forms: delivery zones and the multi-order delivery policy (English, FIRINGI staff). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createZoneAction, setMultiOrderPolicyAction, setZoneActiveAction, updateZoneAction } from "@/server/actions/delivery";
import type { ActionResult } from "@/server/actions/_action";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    start(async () => { setError(null); const r = await fn(); if (r.ok) { after?.(); router.refresh(); } else setError(r.error); });
  return { pending, error, run };
}

export function ZoneForm({ countries, zone }: { countries: { code: string; label: string }[]; zone?: { id: string; countryCode: string; name: string; patterns: string[]; polygon: string } }) {
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ countryCode: zone?.countryCode ?? "PT", name: zone?.name ?? "", patterns: zone?.patterns.join(", ") ?? "", polygon: zone?.polygon ?? "" });
  if (!open) return <Button size={zone ? "sm" : "default"} variant={zone ? "outline" : "default"} onClick={() => setOpen(true)}>{zone ? "Edit" : "New zone"}</Button>;
  const input = { countryCode: f.countryCode, name: f.name, postalCodePatterns: f.patterns.split(/[\s,;]+/).filter(Boolean), polygon: f.polygon || null };
  return (
    <div className="w-full space-y-3 rounded-md border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label>Country</Label><select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
        <div className="space-y-1 sm:col-span-2"><Label>Name</Label><Input name="zoneName" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      </div>
      <div className="space-y-1"><Label>Postal code patterns (comma separated, * = any, e.g. 1000-*, 1100-*)</Label><Input name="zonePatterns" value={f.patterns} onChange={(e) => setF({ ...f, patterns: e.target.value })} /></div>
      <div className="space-y-1"><Label>Map area — GeoJSON Polygon / MultiPolygon (optional; draw it at geojson.io and paste)</Label>
        <textarea name="zonePolygon" className="h-28 w-full rounded-md border border-input bg-background p-2 font-mono text-xs" value={f.polygon} onChange={(e) => setF({ ...f, polygon: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => run(() => (zone ? updateZoneAction({ ...input, id: zone.id }) : createZoneAction(input)), () => setOpen(false))}>Save</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function ZoneActiveToggle({ id, active }: { id: string; active: boolean }) {
  const { pending, error, run } = useAct();
  return (<><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setZoneActiveAction({ id, active: !active }))}>{active ? "Deactivate" : "Activate"}</Button>{error && <span className="text-xs text-destructive">{error}</span>}</>);
}

export function MultiOrderPolicyForm({ policy, canEdit }: { policy: { firingiFleet: boolean; firingiMax: number; vendorsMayUse: boolean; vendorMaxCap: number }; canEdit: boolean }) {
  const { pending, error, run } = useAct();
  const [p, setP] = useState(policy);
  const changed = JSON.stringify(p) !== JSON.stringify(policy);
  return (
    <div className="space-y-4 text-sm">
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" name="firingiFleet" checked={p.firingiFleet} onChange={(e) => setP({ ...p, firingiFleet: e.target.checked })} /> FIRINGI fleet: drivers may carry several orders</label>
          {p.firingiFleet && <div className="flex items-center gap-2">Maximum orders per FIRINGI driver <Input type="number" min={2} max={50} className="w-24" value={p.firingiMax} onChange={(e) => setP({ ...p, firingiMax: Number(e.target.value) })} /></div>}
        </div>
        <div className="space-y-2 rounded-md border p-3">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" name="vendorsMayUse" checked={p.vendorsMayUse} onChange={(e) => setP({ ...p, vendorsMayUse: e.target.checked })} /> Vendors may switch multi-order delivery on for their own fleet</label>
          {p.vendorsMayUse && <div className="flex items-center gap-2">Highest maximum a vendor may choose <Input type="number" min={2} max={50} className="w-24" value={p.vendorMaxCap} onChange={(e) => setP({ ...p, vendorMaxCap: Number(e.target.value) })} /></div>}
          <p className="text-xs text-muted-foreground">Off: every vendor driver carries one order at a time, whatever the vendor chose.</p>
        </div>
      </fieldset>
      {canEdit ? <Button disabled={pending || !changed} onClick={() => run(() => setMultiOrderPolicyAction(p))}>Save</Button> : <p className="text-xs text-muted-foreground">Only Super Admin can change this.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
