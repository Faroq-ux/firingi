"use client";
/** Food safety logbook (Phase 69) — forms for the kitchen (texts passed in as `l`). */
import { useState } from "react";
import { Camera, Check, CheckCheck, Pencil, Plus, Save, Snowflake, Thermometer, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  applyHaccpTemplateAction, deleteHaccpEntryAction, deleteHaccpTrainingAction, logHaccpCoolingAction, logHaccpDeliveryAction, logHaccpTaskAction, logHaccpTempAction,
  saveHaccpTaskAction, saveHaccpTrainingAction, saveHaccpUnitAction,
} from "@/server/actions/haccp";
import { UNIT_DEFAULTS, UNIT_KINDS, TASK_FREQUENCIES, inRange, type UnitKind } from "@/lib/haccp";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const box = "space-y-3 rounded-lg border bg-muted/20 p-3";
const grid = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

function Corrective({ l, value, onChange, id }: { l: L; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-destructive">{l.corrective}</Label>
      <Input id={id} maxLength={500} placeholder={l.correctiveHint} value={value} onChange={(e) => onChange(e.target.value)} data-testid="hc-corrective" />
    </div>
  );
}

// ── today ───────────────────────────────────────────────────────────────────

/** Record a temperature for one check time. */
export function TempEntry({ l, unitId, slot, minC, maxC, limit }: { l: L; unitId: string; slot: string | null; minC: number | null; maxC: number | null; limit: string }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ value: "", corrective: "", note: "" });
  const val = num(v.value);
  const out = val !== null && !Number.isNaN(val) && !inRange(val, minC, maxC);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="hc-temp-open" data-slot={slot ?? ""}><Thermometer className="size-4" /> {slot ?? l.record}</Button>;
  return (
    <form className={box} data-testid="hc-temp-form" onSubmit={(e) => { e.preventDefault(); run(() => logHaccpTempAction({ unitId, slot, valueC: val, corrective: v.corrective || null, note: v.note || null }), () => { setOpen(false); setV({ value: "", corrective: "", note: "" }); }); }}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor={`hc-t-${unitId}-${slot}`}>{l.reading}{slot ? ` · ${slot}` : ""}</Label>
          <Input id={`hc-t-${unitId}-${slot}`} type="number" inputMode="decimal" step="0.1" className="w-32" autoFocus value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} data-testid="hc-temp-value" /></div>
        <p className={`pb-2 text-xs ${out ? "font-medium text-destructive" : "text-muted-foreground"}`} data-testid="hc-temp-limit">{out ? f(l.outOfRange, { limit }) : f(l.limit, { limit })}</p>
      </div>
      {out && <Corrective l={l} id={`hc-c-${unitId}-${slot}`} value={v.corrective} onChange={(c) => setV({ ...v, corrective: c })} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || val === null} data-testid="hc-temp-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

/** Tick a checklist / cleaning task. */
export function TaskEntry({ l, task }: { l: L; task: { id: string; name: string; items: string[]; needsPhoto: boolean } }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [v, setV] = useState({ corrective: "", note: "" });
  const [photo, setPhoto] = useState<File | null>(null);
  const allOk = task.items.every((i) => ticks[i]);
  const someTicked = task.items.some((i) => ticks[i] !== undefined);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="hc-task-open"><Check className="size-4" /> {l.record}</Button>;
  const submit = () => {
    const fd = new FormData();
    fd.set("taskId", task.id); fd.set("results", JSON.stringify(Object.fromEntries(task.items.map((i) => [i, !!ticks[i]]))));
    fd.set("note", v.note); fd.set("corrective", v.corrective);
    if (photo) fd.set("photo", photo);
    run(() => logHaccpTaskAction(fd), () => setOpen(false));
  };
  return (
    <form className={box} data-testid="hc-task-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Button type="button" size="sm" variant="secondary" onClick={() => setTicks(Object.fromEntries(task.items.map((i) => [i, true])))} data-testid="hc-task-all"><CheckCheck className="size-4" /> {l.allOk}</Button>
      <ul className="space-y-1.5">
        {task.items.map((it) => (
          <li key={it}><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={!!ticks[it]} onChange={(e) => setTicks({ ...ticks, [it]: e.target.checked })} data-testid="hc-task-item" />{it}</label></li>
        ))}
      </ul>
      {someTicked && !allOk && <Corrective l={l} id={`hc-tc-${task.id}`} value={v.corrective} onChange={(c) => setV({ ...v, corrective: c })} />}
      {task.needsPhoto && (
        <div className="space-y-1"><Label htmlFor={`hc-ph-${task.id}`}><Camera className="mr-1 inline size-4" />{l.photo} *</Label>
          <Input id={`hc-ph-${task.id}`} type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></div>
      )}
      <div className="space-y-1"><Label htmlFor={`hc-tn-${task.id}`}>{l.note}</Label><Input id={`hc-tn-${task.id}`} maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="hc-task-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

export function CoolingForm({ l, target, maxMinutes }: { l: L; target: number; maxMinutes: number }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ product: "", startC: "", endC: "", minutes: "", corrective: "", note: "" });
  const end = num(v.endC), mins = num(v.minutes);
  const bad = end !== null && mins !== null && (end > target || mins > maxMinutes);
  if (!open) return <div className="space-y-1"><Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="hc-cool-open"><Snowflake className="size-4" /> {l.cooling}</Button><Msg error={null} done={done} /></div>;
  return (
    <form className={box} data-testid="hc-cool-form" onSubmit={(e) => { e.preventDefault(); run(() => logHaccpCoolingAction({ product: v.product, startC: num(v.startC), endC: end, minutes: mins, corrective: v.corrective || null, note: v.note || null }), () => { setOpen(false); setV({ product: "", startC: "", endC: "", minutes: "", corrective: "", note: "" }); }, l.saved); }}>
      <p className="text-xs text-muted-foreground">{f(l.coolingHint, { target, minutes: maxMinutes })}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-4"><Label htmlFor="hc-cp">{l.product}</Label><Input id="hc-cp" maxLength={120} value={v.product} onChange={(e) => setV({ ...v, product: e.target.value })} data-testid="hc-cool-product" /></div>
        <div className="space-y-1"><Label htmlFor="hc-cs">{l.startC}</Label><Input id="hc-cs" type="number" step="0.1" value={v.startC} onChange={(e) => setV({ ...v, startC: e.target.value })} data-testid="hc-cool-start" /></div>
        <div className="space-y-1"><Label htmlFor="hc-ce">{l.endC}</Label><Input id="hc-ce" type="number" step="0.1" value={v.endC} onChange={(e) => setV({ ...v, endC: e.target.value })} data-testid="hc-cool-end" /></div>
        <div className="space-y-1"><Label htmlFor="hc-cm">{l.minutes}</Label><Input id="hc-cm" type="number" min={1} value={v.minutes} onChange={(e) => setV({ ...v, minutes: e.target.value })} data-testid="hc-cool-minutes" /></div>
      </div>
      {bad && <Corrective l={l} id="hc-cc" value={v.corrective} onChange={(c) => setV({ ...v, corrective: c })} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="hc-cool-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

export function DeleteEntry({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} aria-label={l.remove} title={l.remove} onClick={() => run(() => deleteHaccpEntryAction({ id }))} data-testid="hc-del"><Spin on={pending} icon={Trash2} /></Button><Msg error={error} /></span>;
}

// ── deliveries ──────────────────────────────────────────────────────────────

export function DeliveryForm({ l, orderId, seller, chilled, frozenMax, startOpen = false }: { l: L; orderId?: string; seller?: string; chilled: number; frozenMax: number; startOpen?: boolean }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(startOpen);
  const [claim, setClaim] = useState<string | null>(null);
  const [v, setV] = useState({ supplier: "", product: "", valueC: "", frozen: false, packagingOk: true, datesOk: true, corrective: "", note: "" });
  const t = num(v.valueC);
  const bad = !v.packagingOk || !v.datesOk || (t !== null && t > (v.frozen ? frozenMax : chilled));
  if (claim) return <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm" data-testid="hc-claim"><p>{l.claimHint}</p><a className="font-medium text-primary hover:underline" href={claim}>{l.openClaim} →</a></div>;
  if (!open) return <div className="space-y-1"><Button size="sm" variant={orderId ? "outline" : "default"} onClick={() => setOpen(true)} data-testid={orderId ? "hc-del-check" : "hc-del-other"}><Truck className="size-4" /> {orderId ? l.check : l.otherSupplier}</Button><Msg error={null} done={done} /></div>;
  return (
    <form className={box} data-testid="hc-delivery-form" onSubmit={(e) => { e.preventDefault(); run(() => logHaccpDeliveryAction({ orderId: orderId ?? null, supplier: orderId ? seller ?? null : v.supplier || null, product: v.product || null, valueC: v.valueC, frozen: v.frozen, packagingOk: v.packagingOk, datesOk: v.datesOk, corrective: v.corrective || null, note: v.note || null }), (d) => { const r = d as { ok: boolean; claimUrl: string | null }; if (r.claimUrl) setClaim(r.claimUrl); else setOpen(false); }, l.delOk); }}>
      <p className="text-xs text-muted-foreground">{f(l.limits, { chilled, frozen: frozenMax })}</p>
      <div className={grid}>
        {!orderId && <div className="space-y-1"><Label htmlFor="hc-ds">{l.supplier}</Label><Input id="hc-ds" maxLength={80} value={v.supplier} onChange={(e) => setV({ ...v, supplier: e.target.value })} data-testid="hc-del-supplier" /></div>}
        <div className="space-y-1"><Label htmlFor={`hc-dp-${orderId}`}>{l.product}</Label><Input id={`hc-dp-${orderId}`} maxLength={120} value={v.product} onChange={(e) => setV({ ...v, product: e.target.value })} data-testid="hc-del-product" /></div>
        <div className="space-y-1"><Label htmlFor={`hc-dt-${orderId}`}>{l.tempC}</Label><Input id={`hc-dt-${orderId}`} type="number" step="0.1" value={v.valueC} onChange={(e) => setV({ ...v, valueC: e.target.value })} data-testid="hc-del-temp" /></div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={v.frozen} onChange={(e) => setV({ ...v, frozen: e.target.checked })} data-testid="hc-del-frozen" /> {l.frozen}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={v.packagingOk} onChange={(e) => setV({ ...v, packagingOk: e.target.checked })} data-testid="hc-del-pack" /> {l.packagingOk}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={v.datesOk} onChange={(e) => setV({ ...v, datesOk: e.target.checked })} data-testid="hc-del-dates" /> {l.datesOk}</label>
      </div>
      {bad && <Corrective l={l} id={`hc-dc-${orderId}`} value={v.corrective} onChange={(c) => setV({ ...v, corrective: c })} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="hc-del-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

// ── setup ───────────────────────────────────────────────────────────────────

export function TemplateButton({ l, k }: { l: L; k: string }) {
  const { pending, error, done, run } = useRun();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => applyHaccpTemplateAction({ key: k }), (d) => setMsg(f(l.applied, { n: (d as { made: number }).made })))} data-testid={`hc-tpl-${k}`}><Spin on={pending} icon={Plus} /> {l[`tplName.${k}`] ?? k}</Button>
      <Msg error={error} done={msg ?? done} />
    </span>
  );
}

export type UnitDraft = { id?: string; name: string; kind: string; minC: number | null; maxC: number | null; times: string[]; active: boolean };
export function UnitForm({ l, unit }: { l: L; unit?: UnitDraft }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: unit?.name ?? "", kind: unit?.kind ?? "FRIDGE", minC: unit?.minC == null ? "" : String(unit.minC), maxC: unit?.maxC == null ? "" : String(unit.maxC), times: (unit?.times ?? ["09:00", "17:00"]).join(", "), active: unit?.active ?? true });
  if (!open) return unit
    ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="hc-unit-edit"><Pencil className="size-4" /> {l.edit}</Button>
    : <Button size="sm" onClick={() => setOpen(true)} data-testid="hc-unit-add"><Plus className="size-4" /> {l.addUnit}</Button>;
  const setKind = (k: string) => { const d = UNIT_DEFAULTS[k as UnitKind]; setV({ ...v, kind: k, minC: d.minC == null ? "" : String(d.minC), maxC: d.maxC == null ? "" : String(d.maxC) }); };
  return (
    <form className={box} data-testid="hc-unit-form" onSubmit={(e) => { e.preventDefault(); run(() => saveHaccpUnitAction({ id: unit?.id ?? null, input: { name: v.name, kind: v.kind, minC: v.minC, maxC: v.maxC, times: v.times.split(/[\s,;]+/).filter(Boolean), active: v.active } }), () => setOpen(false)); }}>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor="hc-un">{l.name}</Label><Input id="hc-un" maxLength={60} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="hc-unit-name" /></div>
        <div className="space-y-1"><Label htmlFor="hc-uk">{l.kindLabel}</Label><Select id="hc-uk" value={v.kind} onChange={(e) => setKind(e.target.value)} data-testid="hc-unit-kind">{UNIT_KINDS.map((k) => <option key={k} value={k}>{l[`unitKind.${k}`]}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="hc-ut">{l.times}</Label><Input id="hc-ut" placeholder={l.timesHint} value={v.times} onChange={(e) => setV({ ...v, times: e.target.value })} data-testid="hc-unit-times" /></div>
        <div className="space-y-1"><Label htmlFor="hc-umin">{l.minC}</Label><Input id="hc-umin" type="number" step="0.5" value={v.minC} onChange={(e) => setV({ ...v, minC: e.target.value })} data-testid="hc-unit-min" /></div>
        <div className="space-y-1"><Label htmlFor="hc-umax">{l.maxC}</Label><Input id="hc-umax" type="number" step="0.5" value={v.maxC} onChange={(e) => setV({ ...v, maxC: e.target.value })} data-testid="hc-unit-max" /></div>
      </div>
      {unit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {l.active}</label>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="hc-unit-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

export type TaskDraft = { id?: string; name: string; kind: string; frequency: string; weekday: number | null; dayOfMonth: number | null; items: string[]; needsPhoto: boolean; active: boolean };
export function TaskForm({ l, task, photos }: { l: L; task?: TaskDraft; photos: boolean }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: task?.name ?? "", kind: task?.kind ?? "CHECKLIST", frequency: task?.frequency ?? "DAILY", weekday: task?.weekday ?? 1, dayOfMonth: task?.dayOfMonth ?? 1, items: (task?.items ?? []).join("\n"), needsPhoto: task?.needsPhoto ?? false, active: task?.active ?? true });
  if (!open) return task
    ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="hc-task-edit"><Pencil className="size-4" /> {l.edit}</Button>
    : <Button size="sm" onClick={() => setOpen(true)} data-testid="hc-task-add"><Plus className="size-4" /> {l.addTask}</Button>;
  return (
    <form className={box} data-testid="hc-taskdef-form" onSubmit={(e) => { e.preventDefault(); run(() => saveHaccpTaskAction({ id: task?.id ?? null, input: { name: v.name, kind: v.kind, frequency: v.frequency, weekday: v.weekday, dayOfMonth: v.dayOfMonth, items: v.items.split("\n").map((x) => x.trim()).filter(Boolean), needsPhoto: v.needsPhoto, active: v.active } }), () => setOpen(false)); }}>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor="hc-tn">{l.name}</Label><Input id="hc-tn" maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="hc-taskdef-name" /></div>
        <div className="space-y-1"><Label htmlFor="hc-tk">{l.kindLabel}</Label><Select id="hc-tk" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} data-testid="hc-taskdef-kind"><option value="CHECKLIST">{l["taskKind.CHECKLIST"]}</option><option value="CLEANING">{l["taskKind.CLEANING"]}</option></Select></div>
        <div className="space-y-1"><Label htmlFor="hc-tf">{l.frequency}</Label><Select id="hc-tf" value={v.frequency} onChange={(e) => setV({ ...v, frequency: e.target.value })} data-testid="hc-taskdef-freq">{TASK_FREQUENCIES.map((x) => <option key={x} value={x}>{l[`freq.${x}`]}</option>)}</Select></div>
        {v.frequency === "WEEKLY" && <div className="space-y-1"><Label htmlFor="hc-tw">{l.weekday}</Label><Select id="hc-tw" value={v.weekday} onChange={(e) => setV({ ...v, weekday: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{l[`weekdays.d${d}`]}</option>)}</Select></div>}
        {v.frequency === "MONTHLY" && <div className="space-y-1"><Label htmlFor="hc-td">{l.dayOfMonth}</Label><Input id="hc-td" type="number" min={1} max={31} value={v.dayOfMonth} onChange={(e) => setV({ ...v, dayOfMonth: Number(e.target.value) })} /></div>}
      </div>
      <div className="space-y-1"><Label htmlFor="hc-ti">{l.items}</Label><textarea id="hc-ti" rows={5} className="w-full rounded-md border bg-background p-2 text-sm" value={v.items} onChange={(e) => setV({ ...v, items: e.target.value })} data-testid="hc-taskdef-items" /></div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {photos && <label className="flex items-center gap-2"><input type="checkbox" checked={v.needsPhoto} onChange={(e) => setV({ ...v, needsPhoto: e.target.checked })} /> {l.needsPhoto}</label>}
        {task && <label className="flex items-center gap-2"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {l.active}</label>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="hc-taskdef-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

// ── training ────────────────────────────────────────────────────────────────

export type TrainingDraft = { id?: string; personName: string; course: string; certificateNo: string | null; issuedAt: string; expiresAt: string | null };
export function TrainingForm({ l, t }: { l: L; t?: TrainingDraft }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ personName: t?.personName ?? "", course: t?.course ?? "", certificateNo: t?.certificateNo ?? "", issuedAt: t?.issuedAt ?? new Date().toISOString().slice(0, 10), expiresAt: t?.expiresAt ?? "" });
  if (!open) return t
    ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="hc-tr-edit"><Pencil className="size-4" /> {l.edit}</Button>
    : <Button size="sm" onClick={() => setOpen(true)} data-testid="hc-tr-add"><Plus className="size-4" /> {l.add}</Button>;
  return (
    <form className={box} data-testid="hc-tr-form" onSubmit={(e) => { e.preventDefault(); run(() => saveHaccpTrainingAction({ id: t?.id ?? null, input: { ...v, certificateNo: v.certificateNo || null, expiresAt: v.expiresAt || null } }), () => setOpen(false)); }}>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor="hc-trp">{l.person}</Label><Input id="hc-trp" maxLength={80} value={v.personName} onChange={(e) => setV({ ...v, personName: e.target.value })} data-testid="hc-tr-person" /></div>
        <div className="space-y-1"><Label htmlFor="hc-trc">{l.course}</Label><Input id="hc-trc" maxLength={120} value={v.course} onChange={(e) => setV({ ...v, course: e.target.value })} data-testid="hc-tr-course" /></div>
        <div className="space-y-1"><Label htmlFor="hc-trn">{l.certificateNo}</Label><Input id="hc-trn" maxLength={60} value={v.certificateNo} onChange={(e) => setV({ ...v, certificateNo: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="hc-tri">{l.issuedAt}</Label><Input id="hc-tri" type="date" value={v.issuedAt} onChange={(e) => setV({ ...v, issuedAt: e.target.value })} data-testid="hc-tr-issued" /></div>
        <div className="space-y-1"><Label htmlFor="hc-tre">{l.expiresAt}</Label><Input id="hc-tre" type="date" value={v.expiresAt} onChange={(e) => setV({ ...v, expiresAt: e.target.value })} data-testid="hc-tr-expires" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="hc-tr-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}
export function DeleteTraining({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} aria-label={l.delete} title={l.delete} onClick={() => run(() => deleteHaccpTrainingAction({ id }))} data-testid="hc-tr-del"><Spin on={pending} icon={X} /></Button><Msg error={error} /></span>;
}
