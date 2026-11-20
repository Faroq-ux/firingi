"use client";
/** FIRINGI's Staff & Time settings (Phase 52, English): every switch, per-business switches and public holidays. */
import { useEffect, useState } from "react";
import { CalendarPlus, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { deleteHolidayAction, fillHolidaysAction, saveHolidayAction, saveStaffSettingsAction, setStaffSwitchAction } from "@/server/actions/staff";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { StaffSettings } from "@/lib/staff-time";

export function StaffSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Staff & time for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="staff-switch"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setStaffSwitchAction({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function FindStaffBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="staff-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border" data-testid="staff-find-hits">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><StaffSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string }) {
  return <div><Label className="text-xs">{label}</Label><Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />{hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
const TYPES: Record<string, string> = { CUSTOMER: "Customers (restaurants, shops)", WHOLESALER: "Wholesalers", DISTRIBUTOR: "Distributors", ADMIN: "FIRINGI's own staff" };
const PARTS: Record<string, [string, string]> = {
  clock: ["Clock in / out", "Phone (with location), kiosk PIN pad, till; breaks; flags."], rota: ["Rota", "Weekly shift planner, publish, open shifts, working-time warnings."],
  timesheets: ["Timesheets & payroll export", "Weekly hours, overtime, night and holiday hours, approval, CSV exports."], leave: ["Leave", "Holiday, sick, unpaid; manager approval."],
  swaps: ["Shift swaps", "Hand a shift to a colleague; manager approval."], labour: ["Labour cost vs sales", "Hours × rates against till / delivered sales."],
};
const toH = (m: number) => Math.round((m / 60) * 100) / 100, toM = (h: number) => Math.round(h * 60);

export function StaffSettingsForm({ initial }: { initial: StaffSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof StaffSettings>(k: K, v: StaffSettings[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-6" data-testid="ss-form" onSubmit={(e) => { e.preventDefault(); run(() => saveStaffSettingsAction(s), undefined, "Saved."); }}>
      <Box label="Staff & time is on" hint="Off: the pages and the job stop; records already kept stay." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="ss-enabled" />
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who uses it</h3>{Object.entries(TYPES).map(([k, label]) => <Box key={k} label={label} checked={s.types[k as keyof typeof s.types]} onChange={(v) => set("types", { ...s.types, [k]: v })} testid={`ss-type-${k}`} />)}</div>
        <div className="space-y-2"><h3 className="text-sm font-semibold">Parts</h3>{Object.entries(PARTS).map(([k, [label, hint]]) => <Box key={k} label={label} hint={hint} checked={s.parts[k as keyof typeof s.parts]} onChange={(v) => set("parts", { ...s.parts, [k]: v })} testid={`ss-part-${k}`} />)}</div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Clocking in</h3>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Box label="From a phone" checked={s.clock.phone} onChange={(v) => set("clock", { ...s.clock, phone: v })} />
          <Box label="Kiosk PIN pad" checked={s.clock.kiosk} onChange={(v) => set("clock", { ...s.clock, kiosk: v })} />
          <Box label="At the till" checked={s.clock.till} onChange={(v) => set("clock", { ...s.clock, till: v })} />
          <Box label="Check the phone's location" hint="Against the shop / warehouse address." checked={s.clock.location} onChange={(v) => set("clock", { ...s.clock, location: v })} testid="ss-location" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Num label="Distance allowed (m)" value={s.clock.radiusM} onChange={(v) => set("clock", { ...s.clock, radiusM: v })} />
          <div><Label className="text-xs">Outside the distance</Label><Select value={s.clock.outside} onChange={(e) => set("clock", { ...s.clock, outside: e.target.value as "FLAG" | "BLOCK" })} data-testid="ss-outside"><option value="FLAG">Allow, flag it</option><option value="BLOCK">Refuse</option></Select></div>
          <Num label="Late after (min)" value={s.clock.lateGraceMin} onChange={(v) => set("clock", { ...s.clock, lateGraceMin: v })} />
          <Num label="Remind to clock out (min after shift)" value={s.clock.missedReminderMin} onChange={(v) => set("clock", { ...s.clock, missedReminderMin: v })} />
          <Num label="Close open entries after (h)" value={s.clock.autoCloseAfterH} onChange={(v) => set("clock", { ...s.clock, autoCloseAfterH: v })} hint="Flagged “forgot to clock out”." />
          <Num label="Shift reminder (min before)" value={s.reminders.shiftBeforeMin} onChange={(v) => set("reminders", { shiftBeforeMin: v })} hint="0 = none" />
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Working-time rules</h3>
        <p className="text-xs text-muted-foreground">EU Working Time Directive defaults: at most 48 h a week, 11 h rest between shifts, a break after 6 h. Night and overtime as in most Schengen labour codes — set yours.</p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Num label="Daily overtime after (h)" step={0.25} value={toH(s.rules.dailyOvertimeAfterMin)} onChange={(v) => set("rules", { ...s.rules, dailyOvertimeAfterMin: toM(v) })} />
          <Num label="Weekly overtime after (h)" step={0.25} value={toH(s.rules.weeklyOvertimeAfterMin)} onChange={(v) => set("rules", { ...s.rules, weeklyOvertimeAfterMin: toM(v) })} />
          <Num label="Most hours a week (h)" step={0.5} value={toH(s.rules.maxWeeklyMin)} onChange={(v) => set("rules", { ...s.rules, maxWeeklyMin: toM(v) })} />
          <Num label="Rest between shifts (h)" step={0.5} value={toH(s.rules.minRestMin)} onChange={(v) => set("rules", { ...s.rules, minRestMin: toM(v) })} />
          <Num label="Break needed after (h)" step={0.25} value={toH(s.rules.breakAfterMin)} onChange={(v) => set("rules", { ...s.rules, breakAfterMin: toM(v) })} />
          <Num label="Shortest break (min)" value={s.rules.minBreakMin} onChange={(v) => set("rules", { ...s.rules, minBreakMin: v })} />
          <div><Label className="text-xs">Night from</Label><Input type="time" value={s.rules.nightFrom} onChange={(e) => set("rules", { ...s.rules, nightFrom: e.target.value })} /></div>
          <div><Label className="text-xs">Night to</Label><Input type="time" value={s.rules.nightTo} onChange={(e) => set("rules", { ...s.rules, nightTo: e.target.value })} /></div>
        </div>
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Manager approval</h3>
          <Box label="Timesheets are approved by a manager" checked={s.approvals.timesheets} onChange={(v) => set("approvals", { ...s.approvals, timesheets: v })} />
          <Box label="Leave is approved by a manager" hint="Off: leave is approved at once." checked={s.approvals.leave} onChange={(v) => set("approvals", { ...s.approvals, leave: v })} />
          <Box label="Shift swaps are approved by a manager" hint="Off: the colleague who takes it gets it at once." checked={s.approvals.swaps} onChange={(v) => set("approvals", { ...s.approvals, swaps: v })} />
        </div>
        <div className="space-y-2"><h3 className="text-sm font-semibold">Staff themselves</h3>
          <Box label="Staff may take open shifts" checked={s.self.claimOpenShifts} onChange={(v) => set("self", { ...s.self, claimOpenShifts: v })} />
          <Box label="Staff see colleagues' shifts on the rota" checked={s.self.seeColleagues} onChange={(v) => set("self", { ...s.self, seeColleagues: v })} />
          <Num label="Keep time records (years)" value={s.keepYears} onChange={(v) => set("keepYears", v)} hint="Portugal: 5 years. Older records are removed (GDPR)." />
        </div>
      </section>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="ss-save"><Spin on={pending} icon={Check} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function HolidayEditor({ countries, countryId, year, rows }: { countries: { id: string; code: string; name: unknown }[]; countryId: string | null; year: number; rows: { id: string; date: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [date, setDate] = useState(`${year}-01-01`), [name, setName] = useState("");
  return (
    <div className="space-y-3" data-testid="holidays">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <div><Label className="text-xs">Country</Label><Select name="country" defaultValue={countryId ?? ""} className="w-44">{countries.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</Select></div>
        <div><Label className="text-xs">Year</Label><Input name="year" type="number" defaultValue={year} className="w-24" /></div>
        <Button type="submit" size="sm" variant="outline">Show</Button>
        {countryId && <Button type="button" size="sm" disabled={pending} onClick={() => run(() => fillHolidaysAction({ countryId, year }), undefined, "Filled.")} data-testid="holidays-fill"><Spin on={pending} icon={CalendarPlus} /> Fill national holidays</Button>}
      </form>
      {countryId && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveHolidayAction({ countryId, date, name }), () => setName(""), "Saved."); }}>
          <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label className="text-xs">Name (e.g. a regional holiday)</Label><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
          <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>Add</Button>
        </form>
      )}
      <Msg error={error} done={done} />
      {rows.length ? <ul className="divide-y rounded-lg border text-sm" data-testid="holiday-rows">{rows.map((h) => <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-1.5"><span><span className="tabular-nums">{h.date}</span> · {h.name}</span><Button size="sm" variant="ghost" className="h-7 px-1.5" aria-label="Remove" onClick={() => run(() => deleteHolidayAction({ id: h.id }))}><Trash2 className="size-3.5" /></Button></li>)}</ul> : <p className="text-sm text-muted-foreground">No public holidays for this year yet — hours are counted as normal days.</p>}
    </div>
  );
}
