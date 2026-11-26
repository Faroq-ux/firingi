"use client";
/** Services & used cooking oil (Phase 68) — customer and provider forms (texts passed in as `l`). */
import { useState } from "react";
import { Ban, CalendarClock, Check, CheckCircle2, Droplets, Pause, Pencil, Play, Plus, Save, Send, SkipForward, Trash2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  applyProviderAction, changeServicePlanAction, completeServiceVisitAction, confirmServiceVisitAction, deleteFryerLogAction, logFryerAction, missServiceVisitAction,
  moveServiceVisitAction, requestServiceAction, saveFryerAction, setServicePlanStatusAction, skipServiceVisitAction, subscribeServiceAction,
} from "@/server/actions/services";
import { isoDay, type L } from "./text";

const WINDOWS = ["ANY", "MORNING", "AFTERNOON"] as const;
const KINDS = ["CHANGE", "TOP_UP", "TEST", "FILTER"] as const;
const box = "space-y-3 rounded-lg border bg-muted/20 p-3";
const grid = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

// ── customer: take / change a plan ──────────────────────────────────────────

export type PlanDraft = { frequency: string; weekday: number; dayA: number; dayB: number; timeWindow: string; addressId: string; containers: number; containerLitres: number; autoRequestWhenFull: boolean; notes: string };
function PlanForm({ l, frequencies, collection, oil, addresses, initial, submit, onClose }: {
  l: L; frequencies: string[]; collection: boolean; oil: boolean; addresses: { id: string; label: string }[]; initial: PlanDraft;
  submit: (d: PlanDraft) => Promise<{ ok: boolean; error?: string }>; onClose: () => void;
}) {
  const { pending, error, run } = useRun();
  const [d, setD] = useState(initial);
  const set = <K extends keyof PlanDraft>(k: K, v: PlanDraft[K]) => setD({ ...d, [k]: v });
  return (
    <form className={box} data-testid="sv-plan-form" onSubmit={(e) => { e.preventDefault(); run(() => submit(d), () => onClose()); }}>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor="sv-freq">{l.howOften}</Label>
          <Select id="sv-freq" value={d.frequency} onChange={(e) => set("frequency", e.target.value)} data-testid="sv-freq">{frequencies.map((f) => <option key={f} value={f}>{l[`freq.${f}`] ?? f}</option>)}</Select></div>
        {(d.frequency === "WEEKLY" || d.frequency === "BIWEEKLY") && (
          <div className="space-y-1"><Label htmlFor="sv-weekday">{l.weekday}</Label>
            <Select id="sv-weekday" value={d.weekday} onChange={(e) => set("weekday", Number(e.target.value))} data-testid="sv-weekday">{[1, 2, 3, 4, 5, 6, 7].map((w) => <option key={w} value={w}>{l[`weekdays.d${w}`]}</option>)}</Select></div>
        )}
        {(d.frequency === "MONTHLY" || d.frequency === "TWICE_MONTHLY" || d.frequency === "QUARTERLY" || d.frequency === "HALF_YEARLY") && (
          <div className="space-y-1"><Label htmlFor="sv-daya">{l.dayOfMonth}</Label>
            <Input id="sv-daya" type="number" min={1} max={28} value={d.dayA} onChange={(e) => set("dayA", Number(e.target.value))} data-testid="sv-daya" /></div>
        )}
        {d.frequency === "TWICE_MONTHLY" && (
          <div className="space-y-1"><Label htmlFor="sv-dayb">{l.secondDay}</Label>
            <Input id="sv-dayb" type="number" min={1} max={28} value={d.dayB} onChange={(e) => set("dayB", Number(e.target.value))} data-testid="sv-dayb" /></div>
        )}
        {d.frequency !== "ON_REQUEST" && (
          <div className="space-y-1"><Label htmlFor="sv-window">{l.time}</Label>
            <Select id="sv-window" value={d.timeWindow} onChange={(e) => set("timeWindow", e.target.value)} data-testid="sv-window">{WINDOWS.map((w) => <option key={w} value={w}>{l[`window.${w}`]}</option>)}</Select></div>
        )}
        {addresses.length > 1 && (
          <div className="space-y-1"><Label htmlFor="sv-addr">{l.address}</Label>
            <Select id="sv-addr" value={d.addressId} onChange={(e) => set("addressId", e.target.value)} data-testid="sv-address">{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
        )}
        {collection && <>
          <div className="space-y-1"><Label htmlFor="sv-containers">{l.containers}</Label>
            <Input id="sv-containers" type="number" min={0} max={50} value={d.containers} onChange={(e) => set("containers", Number(e.target.value))} data-testid="sv-containers" /></div>
          <div className="space-y-1"><Label htmlFor="sv-litres">{l.containerLitres}</Label>
            <Input id="sv-litres" type="number" min={0} max={5000} value={d.containerLitres} onChange={(e) => set("containerLitres", Number(e.target.value))} data-testid="sv-litres" /></div>
        </>}
      </div>
      {oil && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={d.autoRequestWhenFull} onChange={(e) => set("autoRequestWhenFull", e.target.checked)} data-testid="sv-auto" />{l.autoRequest}</label>}
      <div className="space-y-1"><Label htmlFor="sv-notes">{l.notes}</Label><Input id="sv-notes" maxLength={500} value={d.notes} onChange={(e) => set("notes", e.target.value)} data-testid="sv-notes" /></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="sv-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}
const toInput = (d: PlanDraft) => ({ ...d, addressId: d.addressId || null, notes: d.notes || null });

export function TakeService({ l, type, addresses }: { l: L; type: { id: string; code: string; frequencies: string[]; isCollection: boolean; isOil: boolean }; addresses: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const first = type.frequencies.find((f) => f !== "ON_REQUEST") ?? type.frequencies[0];
  if (!open) return <Button size="sm" onClick={() => setOpen(true)} data-testid={`sv-take-${type.code}`}><Plus className="size-4" /> {l.take}</Button>;
  return (
    <PlanForm l={l} frequencies={type.frequencies} collection={type.isCollection} oil={type.isOil} addresses={addresses} onClose={() => setOpen(false)}
      initial={{ frequency: first, weekday: 2, dayA: 1, dayB: 15, timeWindow: "ANY", addressId: addresses[0]?.id ?? "", containers: type.isCollection ? 2 : 0, containerLitres: type.isOil ? 50 : 0, autoRequestWhenFull: type.isOil, notes: "" }}
      submit={(d) => subscribeServiceAction({ serviceTypeId: type.id, input: toInput(d) })} />
  );
}

export function RequestService({ l, serviceTypeId, code, label, earliest }: { l: L; serviceTypeId: string; code: string; label: string; earliest: string }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ date: earliest, note: "" });
  if (!open) return <div className="space-y-1"><Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`sv-request-${code}`}><Send className="size-4" /> {label}</Button><Msg error={null} done={done} /></div>;
  return (
    <form className={box} data-testid="sv-request-form" onSubmit={(e) => { e.preventDefault(); run(() => requestServiceAction({ serviceTypeId, date: v.date ? new Date(v.date) : null, note: v.note || null }), () => setOpen(false), l.requested); }}>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor={`sv-rd-${code}`}>{l.date}</Label><Input id={`sv-rd-${code}`} type="date" min={earliest} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} data-testid="sv-req-date" /></div>
        <div className="space-y-1 lg:col-span-2"><Label htmlFor={`sv-rn-${code}`}>{l.note}</Label><Input id={`sv-rn-${code}`} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} data-testid="sv-req-note" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="sv-req-send"><Spin on={pending} icon={Send} /> {l.send}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

export function PlanControls({ l, plan, addresses }: {
  l: L; addresses: { id: string; label: string }[];
  plan: PlanDraft & { id: string; status: string; frequencies: string[]; isCollection: boolean; isOil: boolean };
}) {
  const { pending, error, run } = useRun();
  const [edit, setEdit] = useState(false), [pause, setPause] = useState(false), [until, setUntil] = useState("");
  if (edit) return <PlanForm l={l} frequencies={plan.frequencies} collection={plan.isCollection} oil={plan.isOil} addresses={addresses} initial={plan} onClose={() => setEdit(false)} submit={(d) => changeServicePlanAction({ id: plan.id, input: toInput(d) })} />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {plan.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => setEdit(true)} data-testid="sv-change"><Pencil className="size-4" /> {l.change}</Button>}
        {plan.status === "ACTIVE" && !pause && <Button size="sm" variant="outline" onClick={() => setPause(true)} data-testid="sv-pause"><Pause className="size-4" /> {l.pause}</Button>}
        {plan.status === "PAUSED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setServicePlanStatusAction({ id: plan.id, status: "ACTIVE" }))} data-testid="sv-resume"><Spin on={pending} icon={Play} /> {l.resume}</Button>}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm(l.endConfirm)) run(() => setServicePlanStatusAction({ id: plan.id, status: "CANCELLED" })); }} data-testid="sv-end"><Ban className="size-4" /> {l.end}</Button>
      </div>
      {pause && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setServicePlanStatusAction({ id: plan.id, status: "PAUSED", pausedUntil: until ? new Date(until) : null }), () => setPause(false)); }}>
          <div className="space-y-1"><Label htmlFor={`sv-until-${plan.id}`} className="text-xs">{l.pauseUntil}</Label><Input id={`sv-until-${plan.id}`} type="date" value={until} onChange={(e) => setUntil(e.target.value)} data-testid="sv-pause-until" /></div>
          <Button size="sm" type="submit" disabled={pending} data-testid="sv-pause-save"><Spin on={pending} icon={Check} /> {l.pause}</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setPause(false)} aria-label={l.cancel}><X className="size-4" /></Button>
        </form>
      )}
      <Msg error={error} />
    </div>
  );
}

/** Move a visit to another day (customer or provider). */
function MoveVisit({ l, id, date, onClose }: { l: L; id: string; date: string; onClose: () => void }) {
  const { pending, error, run } = useRun();
  const [d, setD] = useState(date);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => moveServiceVisitAction({ id, date: new Date(d) }), onClose); }}>
      <Input type="date" aria-label={l.date} min={isoDay(new Date())} value={d} onChange={(e) => setD(e.target.value)} className="w-40" data-testid="sv-move-date" />
      <Button size="sm" type="submit" disabled={pending} data-testid="sv-move-save"><Spin on={pending} icon={Check} /> {l.move}</Button>
      <Button size="sm" type="button" variant="ghost" onClick={onClose} aria-label={l.cancel}><X className="size-4" /></Button>
      <Msg error={error} />
    </form>
  );
}

export function VisitControls({ l, id, date, canSkip }: { l: L; id: string; date: string; canSkip: boolean }) {
  const { pending, error, run } = useRun();
  const [move, setMove] = useState(false);
  if (move) return <MoveVisit l={l} id={id} date={date} onClose={() => setMove(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => setMove(true)} data-testid="sv-move"><CalendarClock className="size-4" /> {l.move}</Button>
      {canSkip && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => skipServiceVisitAction({ id }))} data-testid="sv-skip"><Spin on={pending} icon={SkipForward} /> {l.skip}</Button>}
      <Msg error={error} />
    </div>
  );
}

// ── fryers & oil ────────────────────────────────────────────────────────────

export function FryerForm({ l, fryer }: { l: L; fryer?: { id: string; name: string; capacityL: number; oilName: string | null; oilCostPerL: number | null; active: boolean } }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: fryer?.name ?? "", capacityL: String(fryer?.capacityL ?? 20), oilName: fryer?.oilName ?? "", oilCostPerL: fryer?.oilCostPerL == null ? "" : String(fryer.oilCostPerL), active: fryer?.active ?? true });
  if (!open) return fryer
    ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="oil-edit"><Pencil className="size-4" /> {l.edit}</Button>
    : <Button size="sm" onClick={() => setOpen(true)} data-testid="oil-add"><Plus className="size-4" /> {l.addFryer}</Button>;
  return (
    <form className={box} data-testid="oil-fryer-form" onSubmit={(e) => { e.preventDefault(); run(() => saveFryerAction({ id: fryer?.id ?? null, input: { name: v.name, capacityL: numOrNull(v.capacityL), oilName: v.oilName || null, oilCostPerL: numOrNull(v.oilCostPerL), active: v.active } }), () => setOpen(false)); }}>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor="oil-name">{l.fryerName}</Label><Input id="oil-name" maxLength={60} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="oil-name" /></div>
        <div className="space-y-1"><Label htmlFor="oil-cap">{l.capacity}</Label><Input id="oil-cap" type="number" step="0.5" min={1} max={500} value={v.capacityL} onChange={(e) => setV({ ...v, capacityL: e.target.value })} data-testid="oil-cap" /></div>
        <div className="space-y-1"><Label htmlFor="oil-oil">{l.oilName}</Label><Input id="oil-oil" maxLength={80} value={v.oilName} onChange={(e) => setV({ ...v, oilName: e.target.value })} data-testid="oil-oilname" /></div>
        <div className="space-y-1"><Label htmlFor="oil-cost">{l.oilCost}</Label><Input id="oil-cost" type="number" step="0.01" min={0} value={v.oilCostPerL} onChange={(e) => setV({ ...v, oilCostPerL: e.target.value })} data-testid="oil-cost" /></div>
      </div>
      {fryer && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {l.active}</label>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="oil-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

export function FryerLog({ l, fryerId, capacityL }: { l: L; fryerId: string; capacityL: number }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ kind: "CHANGE", litres: String(capacityL), polarPct: "", note: "" });
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="oil-log"><Droplets className="size-4" /> {l.log}</Button>;
  return (
    <form className={box} data-testid="oil-log-form" onSubmit={(e) => { e.preventDefault(); run(() => logFryerAction({ fryerId, input: { kind: v.kind, litres: numOrNull(v.litres), polarPct: numOrNull(v.polarPct), note: v.note || null } }), () => setOpen(false)); }}>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor={`oil-kind-${fryerId}`}>{l.kind}</Label>
          <Select id={`oil-kind-${fryerId}`} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} data-testid="oil-kind">{KINDS.map((k) => <option key={k} value={k}>{l[`logKind.${k}`]}</option>)}</Select></div>
        {(v.kind === "CHANGE" || v.kind === "TOP_UP") && <div className="space-y-1"><Label htmlFor={`oil-l-${fryerId}`}>{l.litres}</Label><Input id={`oil-l-${fryerId}`} type="number" step="0.5" min={0} max={500} value={v.litres} onChange={(e) => setV({ ...v, litres: e.target.value })} data-testid="oil-litres" /></div>}
        {v.kind === "TEST" && <div className="space-y-1"><Label htmlFor={`oil-p-${fryerId}`}>{l.polar}</Label><Input id={`oil-p-${fryerId}`} type="number" step="0.5" min={0} max={60} value={v.polarPct} onChange={(e) => setV({ ...v, polarPct: e.target.value })} data-testid="oil-polar" /></div>}
        <div className="space-y-1"><Label htmlFor={`oil-n-${fryerId}`}>{l.note}</Label><Input id={`oil-n-${fryerId}`} maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="oil-log-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

export function DeleteLog({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} aria-label={l.remove} title={l.remove} onClick={() => run(() => deleteFryerLogAction({ id }))} data-testid="oil-del"><Spin on={pending} icon={Trash2} /></Button><Msg error={error} /></span>;
}

// ── provider ────────────────────────────────────────────────────────────────

export function ApplyForm({ l, types, country }: { l: L; types: { id: string; name: string; needsDocument: boolean }[]; country: string }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ serviceTypeId: types[0]?.id ?? "", countries: country, licenceNumber: "", licenceExpiresAt: "", note: "" });
  if (!types.length) return null;
  const t = types.find((x) => x.id === v.serviceTypeId);
  return (
    <form className="space-y-3" data-testid="pv-apply-form" onSubmit={(e) => { e.preventDefault(); run(() => applyProviderAction({ serviceTypeId: v.serviceTypeId, countries: v.countries.split(/[\s,;]+/).filter(Boolean), licenceNumber: v.licenceNumber || null, licenceExpiresAt: v.licenceExpiresAt || null, note: v.note || null }), undefined, l.applied); }}>
      <p className="text-sm text-muted-foreground">{l.applyHint}</p>
      <div className={grid}>
        <div className="space-y-1"><Label htmlFor="pv-service">{l.service}</Label><Select id="pv-service" value={v.serviceTypeId} onChange={(e) => setV({ ...v, serviceTypeId: e.target.value })} data-testid="pv-apply-service">{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="pv-countries">{l.countries}</Label><Input id="pv-countries" value={v.countries} onChange={(e) => setV({ ...v, countries: e.target.value.toUpperCase() })} data-testid="pv-countries" /></div>
        <div className="space-y-1"><Label htmlFor="pv-licence">{l.licence}{t?.needsDocument ? " *" : ""}</Label><Input id="pv-licence" maxLength={60} value={v.licenceNumber} onChange={(e) => setV({ ...v, licenceNumber: e.target.value })} data-testid="pv-licence" /></div>
        <div className="space-y-1"><Label htmlFor="pv-until">{l.licenceUntil}</Label><Input id="pv-until" type="date" value={v.licenceExpiresAt} onChange={(e) => setV({ ...v, licenceExpiresAt: e.target.value })} data-testid="pv-licence-until" /></div>
        <div className="space-y-1 lg:col-span-2"><Label htmlFor="pv-note">{l.note}</Label><Input id="pv-note" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={pending} data-testid="pv-apply"><Spin on={pending} icon={Send} /> {l.apply}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export type ProviderVisitRow = { id: string; status: string; date: string; isCollection: boolean; unit: string; needsSignature: boolean; youInvoice: boolean; containers: number; allowExtras?: boolean };
export function ProviderVisit({ l, v }: { l: L; v: ProviderVisitRow }) {
  const { pending, error, run } = useRun();
  const [mode, setMode] = useState<"" | "move" | "done" | "miss">("");
  const [d, setD] = useState({ extrasNet: "", extrasNote: "", quantity: "", containersTaken: String(v.containers || ""), containersLeft: String(v.containers || ""), signedBy: "", docNumber: "", providerInvoiceNo: "", note: "" });
  const [reason, setReason] = useState("");
  const late = v.date > isoDay(new Date(Date.now() + 86400_000));
  if (mode === "move") return <MoveVisit l={l} id={v.id} date={v.date} onClose={() => setMode("")} />;
  if (mode === "done") return (
    <form className={box} data-testid="pv-done-form" onSubmit={(e) => { e.preventDefault(); run(() => completeServiceVisitAction({ id: v.id, input: { extrasNet: v.allowExtras ? numOrNull(d.extrasNet) : null, extrasNote: v.allowExtras ? d.extrasNote || null : null, quantity: v.isCollection ? numOrNull(d.quantity) : null, containersTaken: numOrNull(d.containersTaken), containersLeft: numOrNull(d.containersLeft), signedBy: d.signedBy || null, docNumber: d.docNumber || null, providerInvoiceNo: d.providerInvoiceNo || null, note: d.note || null } }), () => setMode("")); }}>
      <div className={grid}>
        {v.isCollection && <div className="space-y-1"><Label htmlFor={`pv-q-${v.id}`}>{l.quantity} ({l[`unit.${v.unit}`] ?? v.unit})</Label><Input id={`pv-q-${v.id}`} type="number" step="0.1" min={0} value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value })} data-testid="pv-qty" /></div>}
        {v.isCollection && <div className="space-y-1"><Label htmlFor={`pv-t-${v.id}`}>{l.containersTaken}</Label><Input id={`pv-t-${v.id}`} type="number" min={0} value={d.containersTaken} onChange={(e) => setD({ ...d, containersTaken: e.target.value })} data-testid="pv-taken" /></div>}
        {v.isCollection && <div className="space-y-1"><Label htmlFor={`pv-lf-${v.id}`}>{l.containersLeft}</Label><Input id={`pv-lf-${v.id}`} type="number" min={0} value={d.containersLeft} onChange={(e) => setD({ ...d, containersLeft: e.target.value })} data-testid="pv-left" /></div>}
        <div className="space-y-1"><Label htmlFor={`pv-s-${v.id}`}>{l.signedBy}{v.needsSignature ? " *" : ""}</Label><Input id={`pv-s-${v.id}`} maxLength={120} value={d.signedBy} onChange={(e) => setD({ ...d, signedBy: e.target.value })} data-testid="pv-signed" /></div>
        <div className="space-y-1"><Label htmlFor={`pv-d-${v.id}`}>{l.docNumber}</Label><Input id={`pv-d-${v.id}`} maxLength={60} value={d.docNumber} onChange={(e) => setD({ ...d, docNumber: e.target.value })} data-testid="pv-doc" /></div>
        {v.allowExtras && <div className="space-y-1"><Label htmlFor={`pv-x-${v.id}`}>{l["extras.amount"]}</Label><Input id={`pv-x-${v.id}`} type="number" step="0.01" min={0} value={d.extrasNet} onChange={(e) => setD({ ...d, extrasNet: e.target.value })} data-testid="pv-extras" /></div>}
        {v.allowExtras && <div className="space-y-1"><Label htmlFor={`pv-xn-${v.id}`}>{l["extras.note"]}</Label><Input id={`pv-xn-${v.id}`} maxLength={300} value={d.extrasNote} onChange={(e) => setD({ ...d, extrasNote: e.target.value })} data-testid="pv-extras-note" /></div>}
        {v.youInvoice && <div className="space-y-1"><Label htmlFor={`pv-i-${v.id}`}>{l.yourInvoiceNo} *</Label><Input id={`pv-i-${v.id}`} maxLength={60} value={d.providerInvoiceNo} onChange={(e) => setD({ ...d, providerInvoiceNo: e.target.value })} data-testid="pv-inv" /></div>}
        <div className="space-y-1 sm:col-span-2"><Label htmlFor={`pv-n-${v.id}`}>{l.note}</Label><Input id={`pv-n-${v.id}`} maxLength={1000} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="pv-done-save"><Spin on={pending} icon={CheckCircle2} /> {l.complete}</Button>
        <Button type="button" variant="ghost" onClick={() => setMode("")}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
  if (mode === "miss") return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => missServiceVisitAction({ id: v.id, reason }), () => setMode("")); }}>
      <Input aria-label={l.missReason} placeholder={l.missReason} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-0 flex-1 basis-48" data-testid="pv-miss-reason" />
      <Button size="sm" type="submit" variant="destructive" disabled={pending} data-testid="pv-miss-save"><Spin on={pending} icon={XCircle} /> {l.missed}</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setMode("")} aria-label={l.cancel}><X className="size-4" /></Button>
      <Msg error={error} />
    </form>
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {v.status !== "CONFIRMED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => confirmServiceVisitAction({ id: v.id }))} data-testid="pv-confirm"><Spin on={pending} icon={Check} /> {l.confirm}</Button>}
      <Button size="sm" variant="ghost" onClick={() => setMode("move")} data-testid="pv-move"><CalendarClock className="size-4" /> {l.move}</Button>
      {!late && <Button size="sm" onClick={() => setMode("done")} data-testid="pv-done"><CheckCircle2 className="size-4" /> {l.complete}</Button>}
      <Button size="sm" variant="ghost" onClick={() => setMode("miss")} data-testid="pv-miss"><XCircle className="size-4" /> {l.missed}</Button>
      <Msg error={error} />
    </div>
  );
}
