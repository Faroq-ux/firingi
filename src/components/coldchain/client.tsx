"use client";
/** Cold chain (Phase 42) — interactive parts (texts passed in as `l`; FIRINGI admin parts are in English). */
import { useState } from "react";
import { Check, KeyRound, Plus, Save, Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addEquipmentLogAction, addReceivingEntryAction, createLoggerAction, recordDispatchAction, recordLoadingAction, recordReceiptAction, saveClassAction,
  saveColdChainSettingsAction, saveEquipmentAction, setCategoryClassAction, setLoggerActiveAction, setOfferClassAction,
} from "@/server/actions/coldchain";
import { classify, parseC, type ColdChainSettings } from "@/lib/cold-chain";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
export type Cls = { id: string; name: string; range: string; minC: number | null; maxC: number | null; toleranceC: number; loaded?: number | null };
const TONE = { OK: "success", WARN: "warning", OUT: "destructive" } as const;

/** Live status chip of a typed temperature. */
export function StatusChip({ l, value, cls }: { l: L; value: string; cls: Cls }) {
  const v = parseC(value);
  if (value.trim() === "") return null;
  if (v == null) return <Badge variant="outline">{l.badTemp}</Badge>;
  const st = classify(v, cls);
  return <Badge variant={TONE[st]} data-testid="temp-status" data-status={st}>{l[`status.${st}`]}</Badge>;
}

/** One input per class (°C), with the range and a live status. */
export function TempInputs({ l, classes, value, onChange, prefix = "t" }: { l: L; classes: Cls[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void; prefix?: string }) {
  return (
    <ul className="space-y-2">
      {classes.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 basis-40 break-words">{c.name} <span className="text-xs text-muted-foreground">· {c.range}{c.loaded != null ? ` · ${f(l.atLoading, { temp: c.loaded.toFixed(1).replace(".", ",") })}` : ""}</span></span>
          <Input id={`${prefix}-${c.id}`} aria-label={f(l.tempFor, { cls: c.name })} inputMode="decimal" className="h-9 w-24" placeholder="°C" value={value[c.id] ?? ""} onChange={(e) => onChange({ ...value, [c.id]: e.target.value })} data-testid="temp-input" data-class={c.id} />
          <StatusChip l={l} value={value[c.id] ?? ""} cls={c} />
        </li>
      ))}
    </ul>
  );
}

/** Supplier at dispatch / driver at loading / customer on receipt. */
export function RecordTempsForm({ l, mode, targetId, classes }: { l: L; mode: "DISPATCH" | "LOADING" | "RECEIPT"; targetId: string; classes: Cls[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState<Record<string, string>>({});
  const [probe, setProbe] = useState("");
  const [accepted, setAccepted] = useState(true);
  const [note, setNote] = useState("");
  const filled = Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim()));
  const save = () =>
    run(() => (mode === "DISPATCH" ? recordDispatchAction({ orderId: targetId, temps: filled, probe: probe || null })
      : mode === "LOADING" ? recordLoadingAction({ deliveryId: targetId, temps: filled, probe: probe || null })
      : recordReceiptAction({ orderId: targetId, temps: filled, accepted, note: note || null })), () => setV({}), l.recorded);
  return (
    <div className="space-y-3 rounded-xl border p-3" data-testid={`record-${mode.toLowerCase()}`}>
      <p className="flex items-center gap-2 text-sm font-medium"><Thermometer className="size-4" /> {l[`record.${mode}`]}</p>
      <TempInputs l={l} classes={classes} value={v} onChange={setV} prefix={mode} />
      <div className="flex flex-wrap items-end gap-2">
        {mode !== "RECEIPT" && <div className="space-y-1"><Label htmlFor={`probe-${mode}`}>{l.probe}</Label><Input id={`probe-${mode}`} className="h-9 w-36" value={probe} onChange={(e) => setProbe(e.target.value)} /></div>}
        {mode === "RECEIPT" && (
          <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> {l.goodsAccepted}</label>
            <Input aria-label={l.noteOptional} placeholder={l.noteOptional} className="h-9 w-56 max-w-full" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )}
        <Button size="sm" onClick={save} disabled={pending || !Object.keys(filled).length} data-testid={`save-${mode.toLowerCase()}`}><Spin on={pending} icon={Save} /> {l.saveTemps}</Button>
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}

/** In the proof-of-delivery form: temperatures at the handover; refuse classes out of range (when allowed). */
export function HandoverTemps({ l, classes, value, onChange, refused, onRefuse, refuse, block, required }: {
  l: L; classes: Cls[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void; refused: string[]; onRefuse: (v: string[]) => void; refuse: boolean; block: boolean; required: boolean;
}) {
  if (!classes.length) return null;
  return (
    <div className="space-y-2 rounded-xl border p-3" data-testid="handover-temps">
      <p className="flex items-center gap-2 text-sm font-medium"><Thermometer className="size-4" /> {required ? l.handoverRequired : l.handoverTitle}</p>
      <TempInputs l={l} classes={classes} value={value} onChange={onChange} prefix="h" />
      {classes.map((c) => {
        const v = parseC(value[c.id] ?? "");
        const st = v == null ? null : classify(v, c);
        if (st === "OUT" && block) return <p key={c.id} className="text-sm text-destructive" data-testid="blocked-note">{f(l.blockedNote, { cls: c.name })}</p>;
        if ((st === "OUT" || st === "WARN") && refuse)
          return (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={refused.includes(c.id)} onChange={(e) => onRefuse(e.target.checked ? [...refused, c.id] : refused.filter((x) => x !== c.id))} data-testid="refuse-class" data-class={c.id} />
              {f(l.refuseClass, { cls: c.name })}
            </label>
          );
        return null;
      })}
    </div>
  );
}

// ── supplier ────────────────────────────────────────────────────────────────

export function OfferClassSelect({ l, offerId, own, inherited, classes }: { l: L; offerId: string; own: string | null; inherited: string | null; classes: { id: string; name: string }[] }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState(own ?? "");
  const inh = classes.find((c) => c.id === inherited)?.name ?? l.ambient;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={l.classFor} className="h-9" value={v} disabled={pending} data-testid="offer-class" data-offer={offerId}
        onChange={(e) => { setV(e.target.value); run(() => setOfferClassAction({ offerId, tempClassId: e.target.value || null })); }}>
        <option value="">{f(l.fromCategory, { cls: inh })}</option>
        {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Msg error={error} />
    </div>
  );
}

// ── customer receiving log ──────────────────────────────────────────────────

export function ReceivingForm({ l, classes }: { l: L; classes: { id: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ supplierName: "", product: "", tempClassId: classes[0]?.id ?? "", valueC: "", accepted: true, note: "" });
  return (
    <div className="space-y-3" data-testid="receiving-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="rc-sup">{l.supplier}</Label><Input id="rc-sup" value={v.supplierName} onChange={(e) => setV({ ...v, supplierName: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="rc-prod">{l.product}</Label><Input id="rc-prod" value={v.product} onChange={(e) => setV({ ...v, product: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="rc-cls">{l.tempClass}</Label><Select id="rc-cls" value={v.tempClassId} onChange={(e) => setV({ ...v, tempClassId: e.target.value })}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="rc-temp">{l.tempC}</Label><Input id="rc-temp" inputMode="decimal" value={v.valueC} onChange={(e) => setV({ ...v, valueC: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.accepted} onChange={(e) => setV({ ...v, accepted: e.target.checked })} /> {l.goodsAccepted}</label>
        <Input aria-label={l.noteOptional} placeholder={l.noteOptional} className="h-9 w-64 max-w-full" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        <Button size="sm" disabled={pending || !v.valueC.trim()} onClick={() => run(() => addReceivingEntryAction({ ...v, note: v.note || null }), () => setV({ ...v, product: "", valueC: "", note: "" }), l.recorded)} data-testid="receiving-save"><Spin on={pending} icon={Plus} /> {l.addEntry}</Button>
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── equipment & loggers (supplier / FIRINGI fleet) ──────────────────────────

type Opt = { id: string; label: string };
export function EquipmentForm({ l, vehicles, classes }: { l: L; vehicles: Opt[]; classes: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ kind: "COLD_ROOM" as "VEHICLE_UNIT" | "COLD_ROOM" | "FREEZER" | "PROBE", name: "", vehicleId: "", tempClassId: "", serial: "", check: "1", clean: "7", calibrate: "" });
  const n = (s: string) => (s.trim() ? Math.round(Number(s)) : null);
  return (
    <div className="space-y-3" data-testid="equipment-form">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="eq-kind">{l.kindLabel}</Label><Select id="eq-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>{["VEHICLE_UNIT", "COLD_ROOM", "FREEZER", "PROBE"].map((k) => <option key={k} value={k}>{l[`kind.${k}`]}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="eq-name">{l.name}</Label><Input id="eq-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="eq-name" /></div>
        <div className="space-y-1"><Label htmlFor="eq-serial">{l.serial}</Label><Input id="eq-serial" value={v.serial} onChange={(e) => setV({ ...v, serial: e.target.value })} /></div>
        {v.kind === "VEHICLE_UNIT" && <div className="space-y-1"><Label htmlFor="eq-veh">{l.vehicle}</Label><Select id="eq-veh" value={v.vehicleId} onChange={(e) => setV({ ...v, vehicleId: e.target.value })}><option value="">—</option>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>}
        {v.kind !== "PROBE" && <div className="space-y-1"><Label htmlFor="eq-cls">{l.tempClass}</Label><Select id="eq-cls" value={v.tempClassId} onChange={(e) => setV({ ...v, tempClassId: e.target.value })}><option value="">—</option>{classes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>}
        <div className="space-y-1"><Label htmlFor="eq-check">{l.checkEvery}</Label><Input id="eq-check" type="number" min={1} value={v.check} onChange={(e) => setV({ ...v, check: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="eq-clean">{l.cleanEvery}</Label><Input id="eq-clean" type="number" min={1} value={v.clean} onChange={(e) => setV({ ...v, clean: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="eq-cal">{l.calibrateEvery}</Label><Input id="eq-cal" type="number" min={1} value={v.calibrate} onChange={(e) => setV({ ...v, calibrate: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={pending || !v.name.trim()} data-testid="eq-save"
          onClick={() => run(() => saveEquipmentAction({ kind: v.kind, name: v.name, vehicleId: v.vehicleId || null, tempClassId: v.tempClassId || null, serial: v.serial || null, checkEveryDays: n(v.check), cleanEveryDays: n(v.clean), calibrateEveryDays: n(v.calibrate) }), () => setV({ ...v, name: "", serial: "" }), l.saved)}>
          <Spin on={pending} icon={Plus} /> {l.addEquipment}
        </Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function EquipmentLogForm({ l, equipmentId }: { l: L; equipmentId: string }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState({ kind: "CHECK" as "CHECK" | "CLEANING" | "CALIBRATION" | "SERVICE", ok: true, valueC: "", note: "" });
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="eq-log-form">
      <Select aria-label={l.done} className="h-9" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>{["CHECK", "CLEANING", "CALIBRATION", "SERVICE"].map((k) => <option key={k} value={k}>{l[`task.${k}`]}</option>)}</Select>
      <Input aria-label={l.tempC} placeholder="°C" inputMode="decimal" className="h-9 w-20" value={v.valueC} onChange={(e) => setV({ ...v, valueC: e.target.value })} />
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.ok} onChange={(e) => setV({ ...v, ok: e.target.checked })} /> {l.ok}</label>
      <Input aria-label={l.noteOptional} placeholder={l.noteOptional} className="h-9 w-48 max-w-full" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => addEquipmentLogAction({ equipmentId, kind: v.kind, ok: v.ok, valueC: v.valueC || null, note: v.note || null }), () => setV({ ...v, valueC: "", note: "" }))} data-testid="eq-log-save"><Spin on={pending} icon={Check} /> {l.logIt}</Button>
      <Msg error={error} />
    </div>
  );
}

export function LoggerForm({ l, vehicles, classes }: { l: L; vehicles: Opt[]; classes: Opt[] }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState({ name: "", serial: "", vehicleId: "", tempClassId: classes[0]?.id ?? "" });
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="logger-form">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1"><Label htmlFor="lg-name">{l.name}</Label><Input id="lg-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="lg-serial">{l.serial}</Label><Input id="lg-serial" value={v.serial} onChange={(e) => setV({ ...v, serial: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="lg-veh">{l.vehicle}</Label><Select id="lg-veh" value={v.vehicleId} onChange={(e) => setV({ ...v, vehicleId: e.target.value })}><option value="">—</option>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="lg-cls">{l.tempClass}</Label><Select id="lg-cls" value={v.tempClassId} onChange={(e) => setV({ ...v, tempClassId: e.target.value })}>{classes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>
      </div>
      <Button size="sm" disabled={pending || !v.name.trim()} onClick={() => run(() => createLoggerAction({ name: v.name, serial: v.serial || null, vehicleId: v.vehicleId || null, tempClassId: v.tempClassId || null }), (d) => { setToken((d as { token: string }).token); setV({ ...v, name: "", serial: "" }); })} data-testid="logger-save"><Spin on={pending} icon={KeyRound} /> {l.addLogger}</Button>
      {token && <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="logger-token"><p className="font-medium">{l.tokenOnce}</p><code className="block break-all font-mono text-xs">{token}</code><p className="text-xs text-muted-foreground">{l.tokenHow}</p></div>}
      <Msg error={error} />
    </div>
  );
}

export function LoggerToggle({ l, id, active }: { l: L; id: string; active: boolean }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setLoggerActiveAction({ id, active: !active }))}>{active ? l.deactivate : l.activate}</Button>;
}

// ── FIRINGI (English) ───────────────────────────────────────────────────────

export function SettingsForm({ initial }: { initial: ColdChainSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState<ColdChainSettings>(initial);
  const box = (label: string, checked: boolean, on: (v: boolean) => void, testid?: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} data-testid={testid} /> {label}</label>;
  return (
    <div className="space-y-6" data-testid="cc-settings">
      {box("Cold chain on", s.enabled, (v) => setS({ ...s, enabled: v }))}
      <div className="space-y-2"><p className="text-sm font-medium">Who records temperatures</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Supplier at dispatch", s.record.supplierDispatch, (v) => setS({ ...s, record: { ...s.record, supplierDispatch: v } }), "cc-dispatch")}
          {box("Driver at loading", s.record.driverLoading, (v) => setS({ ...s, record: { ...s.record, driverLoading: v } }))}
          {box("Driver at handover", s.record.driverHandover, (v) => setS({ ...s, record: { ...s.record, driverHandover: v } }))}
          {box("Customer on receipt", s.record.customerReceipt, (v) => setS({ ...s, record: { ...s.record, customerReceipt: v } }))}
          {box("Vehicle / cold-room loggers (API)", s.record.loggers, (v) => setS({ ...s, record: { ...s.record, loggers: v } }))}
          {box("Handover temperature required before delivery", s.requireHandover, (v) => setS({ ...s, requireHandover: v }), "cc-require")}
        </div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">When a temperature is out of range</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("The customer can refuse those products (temperature claim, credited at once)", s.actions.customerRefuse, (v) => setS({ ...s, actions: { ...s.actions, customerRefuse: v } }))}
          {box("Alert the supplier and FIRINGI", s.actions.alert, (v) => setS({ ...s, actions: { ...s.actions, alert: v } }))}
          {box("Block the handover (out-of-range products are refused automatically)", s.actions.block, (v) => setS({ ...s, actions: { ...s.actions, block: v } }), "cc-block")}
          {box("Count breaches in supplier and driver scores", s.actions.score, (v) => setS({ ...s, actions: { ...s.actions, score: v } }))}
        </div>
        <div className="max-w-xs space-y-1"><Label htmlFor="cc-mins">Logger alert after (minutes out of range)</Label><Input id="cc-mins" type="number" min={1} max={240} value={s.loggerAlertMinutes} onChange={(e) => setS({ ...s, loggerAlertMinutes: Math.round(Number(e.target.value) || 1) })} /></div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">HACCP records</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Temperature certificate per delivery (PDF)", s.records.certificate, (v) => setS({ ...s, records: { ...s.records, certificate: v } }))}
          {box("Monthly HACCP report (PDF / CSV)", s.records.monthly, (v) => setS({ ...s, records: { ...s.records, monthly: v } }))}
          {box("Vehicle & equipment logs (checks, cleaning, calibration)", s.records.equipment, (v) => setS({ ...s, records: { ...s.records, equipment: v } }))}
          {box("Customer receiving log (incl. outside suppliers)", s.records.receivingLog, (v) => setS({ ...s, records: { ...s.records, receivingLog: v } }))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button onClick={() => run(() => saveColdChainSettingsAction(s), undefined, "Saved")} disabled={pending} data-testid="cc-settings-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

export type ClassRow = { id: string; code: string; names: Record<string, string>; minC: number | null; maxC: number | null; toleranceC: number; coldChain: boolean; active: boolean; sortOrder: number };
export function ClassForm({ c }: { c?: ClassRow }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ code: c?.code ?? "", nameEn: c?.names.en ?? "", namePt: c?.names.pt ?? "", minC: c?.minC?.toString() ?? "", maxC: c?.maxC?.toString() ?? "", toleranceC: (c?.toleranceC ?? 1).toString(), coldChain: c?.coldChain ?? true, active: c?.active ?? true });
  const n = (s: string) => (s.trim() === "" ? null : parseC(s));
  return (
    <div className="space-y-2" data-testid="class-form">
      <div className="grid gap-2 sm:grid-cols-4">
        <Input aria-label="Code" placeholder="CODE" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        <Input aria-label="Name (English)" placeholder="Name (English)" value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} />
        <Input aria-label="Name (Portuguese)" placeholder="Name (Portuguese)" value={v.namePt} onChange={(e) => setV({ ...v, namePt: e.target.value })} />
        <div className="flex gap-2"><Input aria-label="Min °C" placeholder="min °C" value={v.minC} onChange={(e) => setV({ ...v, minC: e.target.value })} /><Input aria-label="Max °C" placeholder="max °C" value={v.maxC} onChange={(e) => setV({ ...v, maxC: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">Tolerance <Input aria-label="Tolerance °C" className="h-9 w-16" value={v.toleranceC} onChange={(e) => setV({ ...v, toleranceC: e.target.value })} /> °C</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.coldChain} onChange={(e) => setV({ ...v, coldChain: e.target.checked })} /> Cold chain (record temperatures)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Active</label>
        <Button size="sm" disabled={pending} onClick={() => run(() => saveClassAction({ id: c?.id ?? null, code: v.code, nameEn: v.nameEn, namePt: v.namePt || null, minC: n(v.minC), maxC: n(v.maxC), toleranceC: Number(v.toleranceC.replace(",", ".")) || 0, coldChain: v.coldChain, active: v.active, sortOrder: c?.sortOrder ?? 50 }), undefined, "Saved")}><Spin on={pending} icon={Save} /> {c ? "Save" : "Add class"}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function CategoryClassSelect({ categoryId, value, inherited, classes }: { categoryId: string; value: string | null; inherited: string | null; classes: { id: string; name: string }[] }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState(value ?? "");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Select aria-label="Temperature class" className="h-8" value={v} disabled={pending} data-testid="category-class" data-category={categoryId}
        onChange={(e) => { setV(e.target.value); run(() => setCategoryClassAction({ categoryId, tempClassId: e.target.value || null })); }}>
        <option value="">{inherited ? `Inherited: ${classes.find((c) => c.id === inherited)?.name ?? "—"}` : "Ambient / none"}</option>
        {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Msg error={error} />
    </span>
  );
}
