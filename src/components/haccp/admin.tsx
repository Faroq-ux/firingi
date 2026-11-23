"use client";
/** FIRINGI's food safety logbook admin (Phase 69, English): switches, templates, rules, per-business override. */
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveHaccpSettingsAction, setCompanyHaccpAction } from "@/server/actions/haccp";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { HaccpSettings } from "@/server/haccp/settings";

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, hint, testid, step = 1 }: { label: string; value: number; onChange: (v: number) => void; hint?: string; testid?: string; step?: number }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
const PARTS: Record<keyof HaccpSettings["parts"], [string, string]> = {
  temperatures: ["Temperatures", "Fridges, freezers, cold rooms, hot holding — readings at set times against limits."],
  checklists: ["Checklists", "Opening and closing checks."],
  cleaning: ["Cleaning", "Daily, weekly and monthly cleaning tasks."],
  deliveries: ["Delivery checks", "Temperature, packaging and use-by dates on arrival; a failed FIRINGI delivery leads to a claim."],
  cooling: ["Cooling", "Cooked food cooled to the target within the time."],
  training: ["Training", "Food-handler training records with expiry warnings."],
  photos: ["Photos", "Businesses can ask for a photo on a checklist."],
  reports: ["Reports", "The inspector-ready PDF and completion per day."],
  reminders: ["Reminders", "Late temperature checks and training running out (notifications)."],
  ai: ["AI tips", "Fridges drifting towards their limit, checks often missed; the Assistant's food safety answers."],
};
export type HaccpForm = Omit<HaccpSettings, "companies">;
export function HaccpSettingsForm({ initial, templates }: { initial: HaccpForm; templates: { key: string; label: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof HaccpForm>(k: K, v: HaccpForm[K]) => setS({ ...s, [k]: v });
  const r = s.rules, rule = (k: keyof HaccpForm["rules"], v: number) => set("rules", { ...r, [k]: v });
  return (
    <form className="space-y-6" data-testid="hcs-form" onSubmit={(e) => { e.preventDefault(); run(() => saveHaccpSettingsAction(s), undefined, "Saved."); }}>
      <Box label="The food safety logbook is on" hint="Off: the pages, reminders and tips stop; records are kept." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="hcs-enabled" />
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who uses it</h3>
          <Box label="Customers (restaurants, cafés, shops)" checked={s.audiences.customers} onChange={(v) => set("audiences", { ...s.audiences, customers: v })} testid="hcs-aud-customers" />
          <Box label="Wholesalers (their own shop / kitchen)" checked={s.audiences.wholesalers} onChange={(v) => set("audiences", { ...s.audiences, wholesalers: v })} testid="hcs-aud-wholesalers" />
          <h3 className="pt-2 text-sm font-semibold">Templates offered</h3>
          {templates.map((t) => <Box key={t.key} label={t.label} checked={s.templates[t.key] !== false} onChange={(v) => set("templates", { ...s.templates, [t.key]: v })} testid={`hcs-tpl-${t.key}`} />)}
        </div>
        <div className="space-y-2 lg:col-span-2"><h3 className="text-sm font-semibold">Parts</h3>
          <div className="grid gap-2 sm:grid-cols-2">{(Object.keys(PARTS) as (keyof HaccpForm["parts"])[]).map((k) => <Box key={k} label={PARTS[k][0]} hint={PARTS[k][1]} checked={s.parts[k]} onChange={(v) => set("parts", { ...s.parts, [k]: v })} testid={`hcs-part-${k}`} />)}</div>
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Rules (defaults for every business)</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Num label="Cooling target (°C)" step={0.5} value={r.coolingTargetC} onChange={(v) => rule("coolingTargetC", v)} />
          <Num label="Cooling within (minutes)" value={r.coolingMaxMinutes} onChange={(v) => rule("coolingMaxMinutes", v)} />
          <Num label="Late after (minutes)" value={r.graceMinutes} onChange={(v) => rule("graceMinutes", v)} hint="After a check's time" testid="hcs-grace" />
          <Num label="Training warning (days)" value={r.trainingWarnDays} onChange={(v) => rule("trainingWarnDays", v)} />
          <Num label="Chilled delivery max (°C)" step={0.5} value={r.deliveryChilledMaxC} onChange={(v) => rule("deliveryChilledMaxC", v)} />
          <Num label="Frozen delivery max (°C)" step={0.5} value={r.deliveryFrozenMaxC} onChange={(v) => rule("deliveryFrozenMaxC", v)} />
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="hcs-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function CompanyHaccpSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Food safety logbook for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="hcs-company"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setCompanyHaccpAction({ companyId, value: v === "DEFAULT" ? null : v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}
export function FindHaccpBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits((r.data as typeof hits).filter((h) => h.type !== "DISTRIBUTOR")); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="hcs-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><CompanyHaccpSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}
