"use client";
/** FIRINGI's Menu Costing & Waste settings (Phase 54, English): every switch, defaults and per-business switches. */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveKitchenSettingsAction, setKitchenSwitchAction } from "@/server/actions/kitchen";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { KitchenSettings } from "@/lib/kitchen";

export function KitchenSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Menu costing & waste for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="kitchen-switch"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setKitchenSwitchAction({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function FindKitchenBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits((r.data as typeof hits).filter((h) => h.type !== "DISTRIBUTOR")); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="kitchen-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><KitchenSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, hint, testid, step = 1 }: { label: string; value: number; onChange: (v: number) => void; hint?: string; testid?: string; step?: number }) {
  return <div><Label className="text-xs">{label}</Label><Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />{hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
const PARTS: Record<string, [string, string]> = {
  costing: ["Menu costing", "Ingredients (from FIRINGI purchases or by hand), yield, recipes and sub-recipes, food cost % and margin."],
  priceSuggestions: ["Price suggestions", "The price that hits the target; “what if an ingredient gets dearer”."],
  engineering: ["Menu engineering", "Stars, plough-horses, puzzles and dogs from till sales."],
  allergens: ["Allergens per dish", "From the products' food information; copied to the till item."],
  waste: ["Waste log", "Phone-friendly; reason, quantity, cost, CO₂; from purchased lots."],
  wasteReports: ["Waste reports & targets", "By reason and item, weekly, % of purchases against the target."],
  suggestions: ["Suggestions", "Use-first list of lots near their date; order less of what is often wasted."],
  donations: ["Donations", "Logged apart from waste (recipient, receipt)."],
  alerts: ["Alerts", "Ingredient price rises, waste over target, use-first reminders."],
};

export function KitchenSettingsForm({ initial }: { initial: KitchenSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof KitchenSettings>(k: K, v: KitchenSettings[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-6" data-testid="ks-form" onSubmit={(e) => { e.preventDefault(); run(() => saveKitchenSettingsAction(s), undefined, "Saved."); }}>
      <Box label="Menu costing & waste is on" hint="Off: the pages and the job stop; what businesses entered is kept." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="ks-enabled" />
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who uses it</h3>
          <Box label="Customers (restaurants, shops)" checked={s.types.CUSTOMER} onChange={(v) => set("types", { ...s.types, CUSTOMER: v })} testid="ks-type-CUSTOMER" />
          <Box label="Wholesalers (their own kitchen)" checked={s.types.WHOLESALER} onChange={(v) => set("types", { ...s.types, WHOLESALER: v })} testid="ks-type-WHOLESALER" />
        </div>
        <div className="space-y-2 lg:col-span-2"><h3 className="text-sm font-semibold">Parts</h3>
          <div className="grid gap-2 sm:grid-cols-2">{Object.entries(PARTS).map(([k, [label, hint]]) => <Box key={k} label={label} hint={hint} checked={s.parts[k as keyof typeof s.parts]} onChange={(v) => set("parts", { ...s.parts, [k]: v })} testid={`ks-part-${k}`} />)}</div>
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Defaults (each business can set its own)</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Num label="Target food cost %" step={0.5} value={s.targetFoodCostPct} onChange={(v) => set("targetFoodCostPct", v)} testid="ks-target" />
          <div><Label className="text-xs">Cost of FIRINGI purchases</Label><Select value={s.costBasis} onChange={(e) => set("costBasis", e.target.value as KitchenSettings["costBasis"])}><option value="LAST">Last price paid</option><option value="AVERAGE">Average price</option></Select></div>
          <Num label="Average over (days)" value={s.averageDays} onChange={(v) => set("averageDays", v)} />
          <div><Label className="text-xs">Round suggested prices</Label><Select value={s.rounding} onChange={(e) => set("rounding", e.target.value as KitchenSettings["rounding"])}><option value="NONE">Not rounded</option><option value="0.05">Up to 0.05</option><option value="0.10">Up to 0.10</option><option value="0.50">Up to 0.50</option><option value="X.90">Ending .90</option></Select></div>
          <Num label="Waste target (% of purchases)" step={0.5} value={s.wasteTargetPct} onChange={(v) => set("wasteTargetPct", v)} />
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Alerts & suggestions</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Num label="Tell the business when a cost rises by (%)" value={s.priceRiseAlertPct} onChange={(v) => set("priceRiseAlertPct", v)} />
          <Num label="Use-first: lots expiring within (days)" value={s.useFirstDays} onChange={(v) => set("useFirstDays", v)} />
          <Num label="Menu engineering: sales over (days)" value={s.engineeringDays} onChange={(v) => set("engineeringDays", v)} />
          <Num label="“Order less” after waste entries (30 days)" value={s.orderLessMinEntries} onChange={(v) => set("orderLessMinEntries", v)} />
        </div>
      </section>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="ks-save"><Spin on={pending} icon={Check} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
