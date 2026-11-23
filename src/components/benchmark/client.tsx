"use client";
/** Price benchmark (Phase 70) — add a cheaper offer to the cart; FIRINGI's settings (English). */
import { useEffect, useState } from "react";
import { RefreshCw, Save, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { addToCartAction } from "@/server/actions/orders";
import { rebuildBenchmarkAction, saveBenchSettingsAction, setCompanyBenchAction } from "@/server/actions/benchmark";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { BenchSettings } from "@/server/benchmark/settings";

export function AddAlternative({ l, offerId, qty: q0 }: { l: Record<string, string>; offerId: string; qty: number }) {
  const { pending, error, done, run } = useRun();
  const [qty, setQty] = useState(String(Math.max(1, q0)));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input type="number" min={1} aria-label={l.qty} className="h-8 w-16" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="bm-alt-qty" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => addToCartAction({ offerId, qty: Math.max(1, Number(qty) || 1) }), undefined, l.added)} data-testid="bm-alt-add"><Spin on={pending} icon={ShoppingCart} /> {l.addToCart}</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, hint, testid }: { label: string; value: number; onChange: (v: number) => void; hint?: string; testid?: string }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>;
}
const PARTS: Record<keyof BenchSettings["parts"], [string, string]> = {
  savings: ["Savings", "The yearly saving at the median, per product and in total."],
  alternatives: ["Cheaper offers", "Cheaper offers for the same product on FIRINGI, with Add to cart."],
  basket: ["Basket check", "The customer's purchases priced at the market median."],
  trend: ["Price trend", "6 months against the market, with a warning when the customer's price rises faster."],
  ai: ["AI", "The Assistant's price check and the AI Centre's “customer paying above the market”."],
  monthlyMessage: ["Monthly message", "On the 1st: “you could save € a year” (from the minimum below)."],
};
export type BenchForm = Omit<BenchSettings, "companies">;
export function BenchSettingsForm({ initial, types }: { initial: BenchForm; types: string[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof BenchForm>(k: K, v: BenchForm[K]) => setS({ ...s, [k]: v });
  const [countries, setCountries] = useState(initial.offCountries.join(", "));
  return (
    <form className="space-y-6" data-testid="bms-form" onSubmit={(e) => { e.preventDefault(); run(() => saveBenchSettingsAction({ ...s, offCountries: countries.split(/[\s,;]+/).filter(Boolean) }), undefined, "Saved."); }}>
      <Box label="The price benchmark is on" hint="Off: the pages, the job and the messages stop." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="bms-enabled" />
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who sees it</h3>
          <Box label="Customers" checked={s.audiences.customers} onChange={(v) => set("audiences", { ...s.audiences, customers: v })} testid="bms-aud-customers" />
          <Box label="Wholesalers (as buyers)" checked={s.audiences.wholesalers} onChange={(v) => set("audiences", { ...s.audiences, wholesalers: v })} testid="bms-aud-wholesalers" />
          <Box label="Suppliers: their price position" hint="Against what buyers pay; other suppliers never named." checked={s.supplierView} onChange={(v) => set("supplierView", v)} testid="bms-supplier" />
        </div>
        <div className="space-y-2 lg:col-span-2"><h3 className="text-sm font-semibold">Parts</h3>
          <div className="grid gap-2 sm:grid-cols-2">{(Object.keys(PARTS) as (keyof BenchForm["parts"])[]).map((k) => <Box key={k} label={PARTS[k][0]} hint={PARTS[k][1]} checked={s.parts[k]} onChange={(v) => set("parts", { ...s.parts, [k]: v })} testid={`bms-part-${k}`} />)}</div>
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Rules</h3>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Num label="Minimum buyers in a group" value={s.minBuyers} onChange={(v) => set("minBuyers", v)} hint="Anonymity: 3–50" testid="bms-min" />
          <Num label="Period (days)" value={s.periodDays} onChange={(v) => set("periodDays", v)} />
          <Num label="Rebuild every (hours)" value={s.refreshHours} onChange={(v) => set("refreshHours", v)} />
          <Num label="Monthly message from (€ / year)" value={s.notifyMinSaving} onChange={(v) => set("notifyMinSaving", v)} />
          <Num label="Trend warning (points)" value={s.risePp} onChange={(v) => set("risePp", v)} />
        </div>
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Countries left out</h3><Input placeholder="e.g. LU, MT" value={countries} onChange={(e) => setCountries(e.target.value.toUpperCase())} data-testid="bms-off-countries" /></div>
        <div className="space-y-2"><h3 className="text-sm font-semibold">Kinds of business left out</h3>
          <div className="grid gap-1 sm:grid-cols-2">{types.map((t) => <Box key={t} label={t.replace("_", " / ")} checked={s.offTypes.includes(t)} onChange={(v) => set("offTypes", v ? [...s.offTypes, t] : s.offTypes.filter((x) => x !== t))} />)}</div>
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="bms-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
export function RebuildNow() {
  const { pending, error, done, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rebuildBenchmarkAction({}), undefined, "Rebuilt.")} data-testid="bms-rebuild"><Spin on={pending} icon={RefreshCw} /> Rebuild now</Button><Msg error={error} done={done} /></span>;
}

/** FIRINGI: the benchmark for one business — by the general settings, always on, or off. */
export function CompanyBenchSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Price benchmark for this business" value={state} disabled={pending} className="h-8 w-44" data-testid="bms-company"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setCompanyBenchAction({ companyId, value: v === "DEFAULT" ? null : v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (settings)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}
export function FindBenchBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="bms-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="bms-hit"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><CompanyBenchSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}
