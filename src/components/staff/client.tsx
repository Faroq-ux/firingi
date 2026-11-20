"use client";
/** Staff shifts & time (Phase 52) — the interactive parts. Texts come in as `l`. */
import { useEffect, useState } from "react";
import { ArrowLeftRight, Ban, Check, Copy, Delete, Download, KeyRound, LogIn, LogOut, Pause, Play, Plus, Send, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  acceptSwapAction, approveTimesheetAction, cancelLeaveAction, claimShiftAction, clockByPinAction, clockSelfAction, copyWeekAction, decideLeaveAction, decideSwapAction,
  deleteEntryAction, deleteShiftAction, publishWeekAction, reopenTimesheetAction, requestLeaveAction, requestSwapAction, saveEntryAction, saveShiftAction, saveStaffProfileAction,
  setStaffPinAction, submitTimesheetAction,
} from "@/server/actions/staff";
import { LEAVE_KINDS } from "@/lib/staff-time";

type L = Record<string, string>;
type Opt = { id: string; label: string };
const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const nowTime = (locale: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

/** Clock in / out / break from a phone (with the location when FIRINGI asks for it). */
export function ClockButtons({ l, locale, open, onBreak, needLocation, sites }: { l: L; locale: string; open: boolean; onBreak: boolean; needLocation: boolean; sites: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const [busy, setBusy] = useState(false);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [site, setSite] = useState(sites.length === 1 ? sites[0].id : "");
  const go = (action: "IN" | "OUT" | "BREAK_START" | "BREAK_END") => {
    setLocErr(null);
    const send = (lat: number | null, lng: number | null) => run(() => clockSelfAction({ action, lat, lng, siteId: site || null }), undefined, fill(l.clockDone, { action: l[`action.${action}`], time: nowTime(locale) }));
    if (!needLocation || action === "BREAK_START" || action === "BREAK_END") return send(null, null);
    if (!navigator.geolocation) { setLocErr(l.locationNeeded); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); send(p.coords.latitude, p.coords.longitude); },
      () => { setBusy(false); setLocErr(l.locationNeeded); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };
  const wait = pending || busy;
  return (
    <div className="space-y-3" data-testid="clock-buttons">
      {!open && sites.length > 1 && (
        <div className="max-w-xs"><Label htmlFor="clock-site">{l.site}</Label><Select id="clock-site" value={site} onChange={(e) => setSite(e.target.value)}><option value="">{l.nearestSite}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
      )}
      <div className="flex flex-wrap gap-2">
        {!open && <Button size="lg" disabled={wait} onClick={() => go("IN")} data-testid="clock-in"><Spin on={wait} icon={LogIn} /> {l.clockIn}</Button>}
        {open && !onBreak && <Button size="lg" variant="outline" disabled={wait} onClick={() => go("BREAK_START")} data-testid="break-start"><Spin on={wait} icon={Pause} /> {l.breakStart}</Button>}
        {open && onBreak && <Button size="lg" variant="outline" disabled={wait} onClick={() => go("BREAK_END")} data-testid="break-end"><Spin on={wait} icon={Play} /> {l.breakEnd}</Button>}
        {open && <Button size="lg" disabled={wait} onClick={() => go("OUT")} data-testid="clock-out"><Spin on={wait} icon={LogOut} /> {l.clockOut}</Button>}
      </div>
      {busy && <p className="text-sm text-muted-foreground">{l.locating}</p>}
      {locErr && <p className="text-sm text-destructive" role="alert">{locErr}</p>}
      <Msg error={error} done={done} />
    </div>
  );
}

/** The kiosk: a big PIN pad on a shared device (shop / warehouse / till). */
export function KioskPad({ l, locale, sites, via = "KIOSK" }: { l: L; locale: string; sites: Opt[]; via?: "KIOSK" | "TILL" }) {
  const { pending, error, run } = useRun();
  const [pin, setPin] = useState("");
  const [site, setSite] = useState(sites[0]?.id ?? "");
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => { if (!last) return; const t = setTimeout(() => setLast(null), 6000); return () => clearTimeout(t); }, [last]);
  const press = (d: string) => setPin((p) => (p.length < 8 ? p + d : p));
  const act = (action: "AUTO" | "BREAK_START" | "BREAK_END") => {
    if (pin.length < 4) return;
    const p = pin;
    setPin("");
    run(() => clockByPinAction({ pin: p, action, siteId: site || null, via }), (d) => {
      const r = d as { name: string; action: string };
      setLast(fill(l.hello, { name: r.name, action: l[`action.${r.action}`], time: nowTime(locale) }));
    });
  };
  return (
    <div className="mx-auto max-w-sm space-y-4" data-testid="kiosk">
      {sites.length > 1 && <Select aria-label={l.site} value={site} onChange={(e) => setSite(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>}
      <div className="flex h-14 items-center justify-center rounded-xl border bg-muted/40 text-3xl tracking-[0.5em]" aria-label={l.enterPin} data-testid="kiosk-pin">{pin ? "•".repeat(pin.length) : <span className="text-base tracking-normal text-muted-foreground">{l.enterPin}</span>}</div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <Button key={d} type="button" variant="outline" className="h-16 text-2xl" onClick={() => press(d)} data-testid={`kiosk-${d}`}>{d}</Button>)}
        <Button type="button" variant="ghost" className="h-16" onClick={() => setPin("")} aria-label={l.clear}><Delete className="size-6" /></Button>
        <Button type="button" variant="outline" className="h-16 text-2xl" onClick={() => press("0")} data-testid="kiosk-0">0</Button>
        <Button type="button" className="h-16" disabled={pending || pin.length < 4} onClick={() => act("AUTO")} data-testid="kiosk-go"><Spin on={pending} icon={UserCheck} /> {l.inOut}</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" disabled={pending || pin.length < 4} onClick={() => act("BREAK_START")}><Pause className="size-4" /> {l.breakStart}</Button>
        <Button type="button" variant="outline" disabled={pending || pin.length < 4} onClick={() => act("BREAK_END")}><Play className="size-4" /> {l.breakEnd}</Button>
      </div>
      {last && <p className="rounded-xl bg-[color-mix(in_oklch,var(--vivid-teal)_14%,transparent)] p-4 text-center text-lg font-medium" role="status" data-testid="kiosk-result">{last}</p>}
      <Msg error={error} />
    </div>
  );
}

/** A manager adds or edits a shift. */
export function ShiftForm({ l, days, people, sites, initial, dayLabels }: { l: L; days: string[]; people: Opt[]; sites: Opt[]; dayLabels: string[]; initial?: { id: string; day: string; start: string; end: string; breakMinutes: number; membershipId: string | null; siteId: string | null; role: string | null; note: string | null } }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial ?? { id: "", day: days[0], start: "09:00", end: "17:00", breakMinutes: 30, membershipId: people[0]?.id ?? null, siteId: sites[0]?.id ?? null, role: null, note: null });
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV({ ...v, [k]: x });
  return (
    <form className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8 lg:items-end" data-testid="shift-form"
      onSubmit={(e) => { e.preventDefault(); run(() => saveShiftAction({ ...v, id: v.id || null, role: v.role || null, note: v.note || null }), undefined, l.saved); }}>
      <div><Label className="text-xs">{l.day}</Label><Select value={v.day} onChange={(e) => set("day", e.target.value)} data-testid="shift-day">{days.map((d, i) => <option key={d} value={d}>{dayLabels[i]}</option>)}</Select></div>
      <div className="lg:col-span-2"><Label className="text-xs">{l.person}</Label><Select value={v.membershipId ?? ""} onChange={(e) => set("membershipId", e.target.value || null)} data-testid="shift-person"><option value="">{l.openShift}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></div>
      <div><Label className="text-xs">{l.start}</Label><Input type="time" value={v.start} onChange={(e) => set("start", e.target.value)} data-testid="shift-start" /></div>
      <div><Label className="text-xs">{l.end}</Label><Input type="time" value={v.end} onChange={(e) => set("end", e.target.value)} data-testid="shift-end" /></div>
      <div><Label className="text-xs">{l.breakMin}</Label><Input type="number" min={0} max={240} value={v.breakMinutes} onChange={(e) => set("breakMinutes", Number(e.target.value))} data-testid="shift-break" /></div>
      {sites.length > 0 && <div><Label className="text-xs">{l.site}</Label><Select value={v.siteId ?? ""} onChange={(e) => set("siteId", e.target.value || null)}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>}
      <div><Label className="text-xs">{l.role}</Label><Input value={v.role ?? ""} maxLength={60} onChange={(e) => set("role", e.target.value)} /></div>
      <div className="flex items-end gap-2 lg:col-span-8"><Button type="submit" size="sm" disabled={pending} data-testid="shift-save"><Spin on={pending} icon={initial ? Check : Plus} /> {initial ? l.save : l.addShift}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function DeleteShift({ id, l }: { id: string; l: L }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button type="button" size="sm" variant="ghost" className="h-7 px-1.5" disabled={pending} aria-label={l.delete} onClick={() => run(() => deleteShiftAction({ id }))}><Trash2 className="size-3.5" /></Button><Msg error={error} /></span>;
}

export function WeekButtons({ l, week, prevWeek, drafts }: { l: L; week: string; prevWeek: string; drafts: number }) {
  const { pending, error, done, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending || drafts === 0} onClick={() => run(() => publishWeekAction({ week }), undefined, l.published)} data-testid="rota-publish"><Spin on={pending} icon={Send} /> {fill(l.publish, { n: drafts })}</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => copyWeekAction({ from: prevWeek, to: week }), (d) => d, l.copiedOk)} data-testid="rota-copy"><Copy className="size-4" /> {l.copyPrev}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function ClaimShift({ id, l }: { id: string; l: L }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => claimShiftAction({ id }))} data-testid="claim-shift"><Spin on={pending} icon={Plus} /> {l.take}</Button><Msg error={error} /></span>;
}

export function SwapOffer({ shiftId, l, colleagues }: { shiftId: string; l: L; colleagues: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(""), [note, setNote] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="swap-open"><ArrowLeftRight className="size-4" /> {l.offerSwap}</Button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => requestSwapAction({ shiftId, toMembershipId: to || null, note: note || null }), () => setOpen(false), l.offered); }}>
      <Select aria-label={l.offerSwap} value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-44" data-testid="swap-to"><option value="">{l.anyone}</option>{colleagues.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
      <Input aria-label={l.swapNote} placeholder={l.swapNote} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="h-8 w-48" />
      <Button size="sm" type="submit" disabled={pending} data-testid="swap-send"><Spin on={pending} icon={Send} /> {l.send}</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

export function AcceptSwap({ id, l }: { id: string; l: L }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" disabled={pending} onClick={() => run(() => acceptSwapAction({ id }))} data-testid="swap-accept"><Spin on={pending} icon={Check} /> {l.acceptSwap}</Button><Msg error={error} /></span>;
}

export function LeaveForm({ l }: { l: L }) {
  const { pending, error, done, run } = useRun();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState({ kind: "HOLIDAY" as (typeof LEAVE_KINDS)[number], startsOn: today, endsOn: today, halfDay: false, reason: "" });
  return (
    <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" data-testid="leave-form"
      onSubmit={(e) => { e.preventDefault(); run(() => requestLeaveAction({ ...v, endsOn: v.halfDay ? v.startsOn : v.endsOn, reason: v.reason || null }), undefined, l.asked); }}>
      <div><Label className="text-xs">{l.kind}</Label><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })} data-testid="leave-kind">{LEAVE_KINDS.map((k) => <option key={k} value={k}>{l[`leave.${k}`]}</option>)}</Select></div>
      <div><Label className="text-xs">{l.from}</Label><Input type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value, endsOn: e.target.value > v.endsOn ? e.target.value : v.endsOn })} data-testid="leave-from" /></div>
      <div><Label className="text-xs">{l.to}</Label><Input type="date" value={v.halfDay ? v.startsOn : v.endsOn} disabled={v.halfDay} min={v.startsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} data-testid="leave-to" /></div>
      <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" checked={v.halfDay} onChange={(e) => setV({ ...v, halfDay: e.target.checked })} />{l.halfDay}</label>
      <div><Label className="text-xs">{l.reason}</Label><Input value={v.reason} maxLength={300} onChange={(e) => setV({ ...v, reason: e.target.value })} /></div>
      <div className="flex items-end gap-2"><Button type="submit" size="sm" disabled={pending} data-testid="leave-send"><Spin on={pending} icon={Send} /> {l.ask}</Button></div>
      <div className="lg:col-span-6"><Msg error={error} done={done} /></div>
    </form>
  );
}

export function CancelLeave({ id, l }: { id: string; l: L }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelLeaveAction({ id }))}><Ban className="size-4" /> {l.cancel}</Button><Msg error={error} /></span>;
}

export function PinForm({ membershipId, l, compact }: { membershipId: string; l: L; compact?: boolean }) {
  const { pending, error, done, run } = useRun();
  const [pin, setPin] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setStaffPinAction({ membershipId, pin }), () => setPin(""), l.pinSet); }} data-testid="pin-form">
      {!compact && <div><Label className="text-xs" htmlFor={`pin-${membershipId}`}>{l.pinHint}</Label></div>}
      <Input id={`pin-${membershipId}`} aria-label={l.pinHint} type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,8}" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="h-8 w-28" data-testid="pin-input" />
      <Button size="sm" type="submit" variant="outline" disabled={pending || pin.length < 4} data-testid="pin-save"><Spin on={pending} icon={KeyRound} /> {l.savePin}</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

export function ProfileForm({ l, p, sites }: { l: L; sites: Opt[]; p: { membershipId: string; role: string | null; contractHours: number | null; hourlyRate: number | null; homeSiteId: string | null; payrollCode: string | null; active: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ role: p.role ?? "", contractHours: p.contractHours == null ? "" : String(p.contractHours), hourlyRate: p.hourlyRate == null ? "" : String(p.hourlyRate), homeSiteId: p.homeSiteId ?? "", payrollCode: p.payrollCode ?? "", active: p.active });
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  return (
    <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7 lg:items-end" data-testid="profile-form"
      onSubmit={(e) => { e.preventDefault(); run(() => saveStaffProfileAction({ membershipId: p.membershipId, role: v.role || null, contractHours: n(v.contractHours), hourlyRate: n(v.hourlyRate), homeSiteId: v.homeSiteId || null, payrollCode: v.payrollCode || null, active: v.active }), undefined, l.saved); }}>
      <div><Label className="text-xs">{l.role}</Label><Input value={v.role} maxLength={60} onChange={(e) => setV({ ...v, role: e.target.value })} data-testid="profile-role" /></div>
      <div><Label className="text-xs">{l.contractHours}</Label><Input inputMode="decimal" value={v.contractHours} onChange={(e) => setV({ ...v, contractHours: e.target.value })} data-testid="profile-hours" /></div>
      <div><Label className="text-xs">{l.rate}</Label><Input inputMode="decimal" value={v.hourlyRate} onChange={(e) => setV({ ...v, hourlyRate: e.target.value })} data-testid="profile-rate" /></div>
      <div><Label className="text-xs">{l.homeSite}</Label><Select value={v.homeSiteId} onChange={(e) => setV({ ...v, homeSiteId: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
      <div><Label className="text-xs">{l.payrollCode}</Label><Input value={v.payrollCode} maxLength={40} onChange={(e) => setV({ ...v, payrollCode: e.target.value })} /></div>
      <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />{l.active}</label>
      <div className="flex items-end gap-2"><Button size="sm" type="submit" disabled={pending} data-testid="profile-save"><Spin on={pending} icon={Check} /> {l.save}</Button></div>
      <div className="lg:col-span-7"><Msg error={error} done={done} /></div>
    </form>
  );
}

/** A manager corrects or adds an entry (a reason is required and kept). */
export function EntryForm({ l, membershipId, sites, initial, defaultDay }: { l: L; membershipId: string; sites: Opt[]; defaultDay: string; initial?: { id: string; day: string; in: string; out: string | null; breakMinutes: number; siteId: string | null } }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ day: initial?.day ?? defaultDay, in: initial?.in ?? "09:00", out: initial?.out ?? "17:00", breakMinutes: initial?.breakMinutes ?? 30, siteId: initial?.siteId ?? sites[0]?.id ?? "", reason: "" });
  if (!open) return <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpen(true)} data-testid={initial ? "entry-edit" : "entry-add"}>{initial ? l.editEntry : <><Plus className="size-3.5" /> {l.addEntry}</>}</Button>;
  return (
    <form className="grid w-full gap-2 rounded-lg border p-2 sm:grid-cols-3 lg:grid-cols-7 lg:items-end" data-testid="entry-form"
      onSubmit={(e) => { e.preventDefault(); run(() => saveEntryAction({ id: initial?.id ?? null, membershipId, day: v.day, in: v.in, out: v.out || null, breakMinutes: v.breakMinutes, siteId: v.siteId || null, reason: v.reason }), () => setOpen(false), l.saved); }}>
      <div><Label className="text-xs">{l.day}</Label><Input type="date" value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })} /></div>
      <div><Label className="text-xs">{l.clockedIn}</Label><Input type="time" value={v.in} onChange={(e) => setV({ ...v, in: e.target.value })} data-testid="entry-in" /></div>
      <div><Label className="text-xs">{l.clockedOut}</Label><Input type="time" value={v.out ?? ""} onChange={(e) => setV({ ...v, out: e.target.value })} data-testid="entry-out" /></div>
      <div><Label className="text-xs">{l.breakMin}</Label><Input type="number" min={0} max={480} value={v.breakMinutes} onChange={(e) => setV({ ...v, breakMinutes: Number(e.target.value) })} /></div>
      <div className="lg:col-span-2"><Label className="text-xs">{l.reasonRequired}</Label><Input required minLength={3} maxLength={300} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} data-testid="entry-reason" /></div>
      <div className="flex items-end gap-2"><Button size="sm" type="submit" disabled={pending} data-testid="entry-save"><Spin on={pending} icon={Check} /> {l.save}</Button>
        {initial && <Button size="sm" type="button" variant="ghost" disabled={pending || v.reason.trim().length < 3} aria-label={l.delete} onClick={() => run(() => deleteEntryAction({ id: initial.id, reason: v.reason }))}><Trash2 className="size-4" /></Button>}</div>
      <div className="lg:col-span-7"><Msg error={error} done={done} /></div>
    </form>
  );
}

export function SheetButtons({ l, membershipId, week, status, self }: { l: L; membershipId: string; week: string; status: string; self?: boolean }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {self && status === "OPEN" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => submitTimesheetAction({ week }), undefined, l.submitted)} data-testid="sheet-submit"><Spin on={pending} icon={Send} /> {l.submitWeek}</Button>}
      {!self && status !== "APPROVED" && <Button size="sm" disabled={pending} onClick={() => run(() => approveTimesheetAction({ membershipId, week }))} data-testid="sheet-approve"><Spin on={pending} icon={Check} /> {l.approve}</Button>}
      {!self && status === "APPROVED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reopenTimesheetAction({ membershipId, week }))} data-testid="sheet-reopen">{l.reopen}</Button>}
      <Msg error={error} done={done} />
    </span>
  );
}

export function DecideLeave({ id, l, swap }: { id: string; l: L; swap?: boolean }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  const act = (approve: boolean) => run(() => (swap ? decideSwapAction({ id, approve, note: note || null }) : decideLeaveAction({ id, approve, note: note || null })));
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid={swap ? "swap-decide" : "leave-decide"}>
      <Button size="sm" disabled={pending} onClick={() => act(true)} data-testid={swap ? "swap-approve" : "leave-approve"}><Check className="size-4" /> {l.approveBtn}</Button>
      <Input aria-label={l.rejectReason} placeholder={l.rejectReason} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="h-8 w-56 max-w-full" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => act(false)}><Ban className="size-4" /> {l.reject}</Button>
      <Msg error={error} />
    </span>
  );
}

/** Payroll / time-record export for a period. */
export function ExportForm({ l, base, from, to }: { l: L; base: string; from: string; to: string }) {
  const [a, setA] = useState(from), [b, setB] = useState(to);
  const href = (kind: string) => `${base}?kind=${kind}&from=${a}&to=${b}`;
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="staff-export">
      <div><Label className="text-xs">{l.from}</Label><Input type="date" value={a} onChange={(e) => setA(e.target.value)} /></div>
      <div><Label className="text-xs">{l.to}</Label><Input type="date" value={b} min={a} onChange={(e) => setB(e.target.value)} /></div>
      <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted" href={href("PAYROLL")} data-testid="export-payroll"><Download className="size-4" /> {l.payroll}</a>
      <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted" href={href("RECORD")} data-testid="export-record"><Download className="size-4" /> {l.record}</a>
    </div>
  );
}
