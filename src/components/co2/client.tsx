"use client";
/** Sustainability & CO₂ (Phase 51) — supplier values, buyer goal, vehicle fuel. Texts come in as `l`. */
import { useState } from "react";
import { Check, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveOfferCo2Action, setCo2GoalAction, setVehicleFuelAction } from "@/server/actions/co2";
import { FUELS, PACKAGINGS } from "@/lib/co2";

type L = Record<string, string>;

export function OfferCo2Form({ l, offerId, initial, categoryKgPerKg }: { l: L; offerId: string; categoryKgPerKg: number; initial: { kgPerKg: number | null; packaging: string | null; recyclable: boolean; source: string | null } | null }) {
  const { pending, error, done, run } = useRun();
  const [kg, setKg] = useState(initial?.kgPerKg != null ? String(initial.kgPerKg) : ""), [pack, setPack] = useState(initial?.packaging ?? ""), [rec, setRec] = useState(initial?.recyclable ?? false), [src, setSrc] = useState(initial?.source ?? "");
  return (
    <form className="grid gap-2 sm:grid-cols-[8rem_10rem_auto_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run(() => saveOfferCo2Action({ offerId, kgPerKg: kg === "" ? null : Number(kg), packaging: (pack || null) as never, recyclable: rec, source: src || null }), undefined, l.saved); }} data-testid="co2-offer-form">
      <div><Label className="text-xs">{l.kgPerKgInput}</Label><Input type="number" step="0.001" min={0} placeholder={String(categoryKgPerKg)} value={kg} onChange={(e) => setKg(e.target.value)} data-testid="co2-kg-input" /></div>
      <div><Label className="text-xs">{l.packagingLabel}</Label><Select value={pack} onChange={(e) => setPack(e.target.value)} data-testid="co2-pack-input"><option value="">—</option>{PACKAGINGS.map((p) => <option key={p} value={p}>{l[`packaging.${p}`]}</option>)}</Select></div>
      <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={rec} onChange={(e) => setRec(e.target.checked)} data-testid="co2-rec-input" />{l.recyclable}</label>
      <div><Label className="text-xs">{l.sourceInput}</Label><Input placeholder={l.sourcePh} maxLength={300} value={src} onChange={(e) => setSrc(e.target.value)} data-testid="co2-src-input" /></div>
      <Button type="submit" size="sm" disabled={pending} data-testid="co2-save"><Spin on={pending} icon={Check} /> {l.save}</Button>
      <div className="sm:col-span-5"><Msg error={error} done={done} /></div>
    </form>
  );
}

export function GoalForm({ l, year, current }: { l: L; year: number; current: number | null }) {
  const { pending, error, done, run } = useRun();
  const [pct, setPct] = useState(current != null ? String(current) : "10");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setCo2GoalAction({ year, reductionPct: Number(pct) }), undefined, l.saved); }} data-testid="co2-goal-form">
      <div><Label htmlFor="co2-goal">{l.goalInput.replace("{year}", String(year))}</Label><Input id="co2-goal" type="number" min={1} max={90} className="w-28" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="co2-goal-input" /></div>
      <Button type="submit" size="sm" disabled={pending} data-testid="co2-goal-save"><Spin on={pending} icon={Target} /> {l.setGoal}</Button>
      {current != null && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setCo2GoalAction({ year, reductionPct: null }))}>{l.removeGoal}</Button>}
      <Msg error={error} done={done} />
    </form>
  );
}

export function FuelSelect({ vehicleId, fuel, labels }: { vehicleId: string; fuel: string | null; labels: Record<string, string> }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState(fuel ?? "");
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label={labels.label ?? "Fuel"} className="h-8 w-36" value={v} disabled={pending} data-testid="vehicle-fuel"
        onChange={(e) => { const n = e.target.value; setV(n); run(() => setVehicleFuelAction({ vehicleId, fuel: (n || null) as never })); }}>
        <option value="">{labels.unknown ?? "—"}</option>{FUELS.map((f) => <option key={f} value={f}>{labels[f] ?? f}</option>)}
      </Select>
      <Msg error={error} />
    </span>
  );
}
