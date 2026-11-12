"use client";
/** FIRINGI demand-planning controls (Phase 30) — English, admin portal. */
import { useState } from "react";
import { Check, Megaphone, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun, type Opt } from "@/components/shared/run";
import { flagSupplierAction, runPlanningNowAction, saveGlobalEventAction, savePlanningDefaultsAction, setEventActiveAction } from "@/server/actions/planning";
import type { PlanningDefaults } from "@/server/planning/engine";

export function RunPlanningNow() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} data-testid="run-planning" onClick={() => run(() => runPlanningNowAction({}), undefined, "Planned all suppliers")}><Spin on={pending} icon={Play} />Run planning now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function FlagSupplier({ id, flaggedAt }: { id: string; flaggedAt: string | null }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  if (flaggedAt && !done) return <span className="text-xs text-muted-foreground">Asked {flaggedAt}</span>;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="flag-open"><Megaphone className="size-4" />Ask to restock</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input className="h-8 w-56" placeholder="Message (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Message" />
      <Button size="sm" disabled={pending || !!done} data-testid="flag-send" onClick={() => run(() => flagSupplierAction({ id, message: msg || null }), undefined, "Supplier asked")}>Send</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function PlanningDefaultsForm({ initial }: { initial: PlanningDefaults }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const num = (k: Exclude<keyof PlanningDefaults, "notify">, label: string, hint: string, min: number, max: number, unit: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pd-${k}`}>{label}</Label>
      <div className="flex items-center gap-2"><Input id={`pd-${k}`} type="number" min={min} max={max} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-28" data-testid={`pd-${k}`} /><span className="text-sm text-muted-foreground">{unit}</span></div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(() => savePlanningDefaultsAction(v), undefined, "Saved"); }}>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Defaults for every supplier (each can change its own)</legend>
        {num("serviceLevel", "Service level", "Share of order cycles without running out. Higher = more safety stock.", 50, 99, "%")}
        {num("reviewDays", "Order every", "How often suppliers usually place purchase orders.", 1, 60, "days")}
        {num("overstockDays", "Overstock after", "More stock than this many days of demand is overstock.", 14, 365, "days")}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Forecast</legend>
        {num("leadTimeDays", "Default lead time", "When a product has no supplier or purchase history yet.", 0, 60, "days")}
        {num("historyWeeks", "History used", "Weeks of sales the forecast learns from (52+ allows seasonality).", 8, 104, "weeks")}
        {num("horizonWeeks", "Forecast ahead", "Weeks forecast and stored every night.", 4, 26, "weeks")}
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.notify} onChange={(e) => setV({ ...v, notify: e.target.checked })} data-testid="pd-notify" />Tell suppliers (e-mail / push) when products need ordering</label>
      <div className="flex items-center gap-2"><Button type="submit" disabled={pending} data-testid="save-defaults"><Spin on={pending} icon={Save} />Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function GlobalEventForm({ countries, categories }: { countries: Opt[]; categories: Opt[] }) {
  const { pending, error, done, run } = useRun();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState({ name: "", startsOn: today, endsOn: today, upliftPct: "20", countryId: "", categoryIds: [] as string[] });
  return (
    <form className="space-y-3" data-testid="global-event-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveGlobalEventAction({ name: v.name, startsOn: v.startsOn, endsOn: v.endsOn, upliftPct: Number(v.upliftPct), countryId: v.countryId || null, categoryIds: v.categoryIds }), () => setV({ ...v, name: "", categoryIds: [] }), "Event added");
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="ge-name">Name</Label><Input id="ge-name" required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Santos Populares" data-testid="ge-name" /></div>
        <div className="space-y-1"><Label htmlFor="ge-from">From</Label><Input id="ge-from" type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="ge-to">To</Label><Input id="ge-to" type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} data-testid="ge-to" /></div>
        <div className="space-y-1"><Label htmlFor="ge-pct">Effect on demand</Label><div className="flex items-center gap-2"><Input id="ge-pct" type="number" min={-90} max={300} value={v.upliftPct} onChange={(e) => setV({ ...v, upliftPct: e.target.value })} className="w-24" data-testid="ge-pct" /><span className="text-sm text-muted-foreground">%</span></div></div>
        <div className="space-y-1"><Label htmlFor="ge-country">Country</Label>
          <Select id="ge-country" value={v.countryId} onChange={(e) => setV({ ...v, countryId: e.target.value })}><option value="">All countries</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label htmlFor="ge-cats">Categories (none = all products)</Label>
          <Select id="ge-cats" multiple className="h-28" value={v.categoryIds} onChange={(e) => setV({ ...v, categoryIds: [...e.target.selectedOptions].map((o) => o.value) })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
        </div>
      </div>
      <div className="flex items-center gap-2"><Button type="submit" disabled={pending} data-testid="save-global-event"><Spin on={pending} icon={Check} />Add event</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function GlobalEventToggle({ id, active }: { id: string; active: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} data-testid={`ge-toggle-${id}`} onClick={() => run(() => setEventActiveAction({ id, active: !active }))}>{active ? "Switch off" : "Switch on"}</Button>
      <Msg error={error} />
    </span>
  );
}
