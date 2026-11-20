"use client";
/** FIRINGI's sustainability & CO₂ controls (Phase 51, English). */
import { useEffect, useState } from "react";
import { Ban, Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { reviewOfferCo2Action, saveCategoryFactorAction, saveCo2SettingsAction, setCo2SwitchAction } from "@/server/actions/co2";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import { FUELS, PACKAGINGS, type Co2Settings } from "@/lib/co2";

export function ReviewValue({ offerId }: { offerId: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="co2-review">
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewOfferCo2Action({ offerId, approve: true, note: note || null }))} data-testid="co2-approve"><Check className="size-4" /> Approve</Button>
      <Input aria-label="Reason" placeholder="Reason (to turn down — the supplier sees it)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-64 max-w-full" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewOfferCo2Action({ offerId, approve: false, note }))} data-testid="co2-reject"><Ban className="size-4" /> Turn down</Button>
      <Msg error={error} />
    </span>
  );
}

export function FactorEdit({ categoryId, kgPerKg, own, source }: { categoryId: string; kgPerKg: number; own: boolean; source: string | null }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(own ? String(kgPerKg) : ""), [src, setSrc] = useState(source ?? "");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Input aria-label="kg CO₂e per kg" type="number" step="0.001" min={0} placeholder={String(kgPerKg)} className="h-8 w-24" value={v} onChange={(e) => setV(e.target.value)} data-testid="co2-factor" />
      <Input aria-label="Source" placeholder="Source" className="h-8 w-44" value={src} onChange={(e) => setSrc(e.target.value)} />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => saveCategoryFactorAction({ categoryId, kgPerKg: v === "" ? null : Number(v), source: src || null }), undefined, "Saved.")} data-testid="co2-factor-save"><Check className="size-4" /></Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function Co2Switch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="CO₂ for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="co2-switch"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setCo2SwitchAction({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function FindCo2Business() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="co2-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border" data-testid="co2-find-hits">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><Co2Switch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
const PART: Record<string, [string, string]> = { products: ["Products", "Production footprint per kg of product."], delivery: ["Delivery transport", "Road distance × tonnes × the vehicle's fuel."], packaging: ["Packaging", "Per item by packaging type."], local: ["Local sourcing", "Supplier within the local distance of the buyer."] };
const SHOW: Record<string, string> = { badges: "Badges and filter in the shop", orders: "CO₂ in the cart and on orders", reports: "Green reports", export: "CSRD-style export (CSV / PDF)", alternatives: "Lower-CO₂ alternatives on product pages", goals: "Buyers' yearly goals", supplierScore: "Suppliers' green grade" };

export function Co2SettingsForm({ initial }: { initial: Co2Settings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof Co2Settings>(k: K, v: Co2Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const num = (k: "lowPct" | "localKm" | "roadFactor" | "fallbackKgPerKg" | "fallbackUnitKg", label: string, hint?: string) => <div><Label htmlFor={`cs-${k}`}>{label}</Label><Input id={`cs-${k}`} type="number" step="any" value={s[k]} onChange={(e) => set(k, Number(e.target.value))} data-testid={`cs-${k}`} />{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>;
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => saveCo2SettingsAction(s), undefined, "Saved."); }} data-testid="cs-form">
      <Box label="Sustainability & CO₂ is on" hint="Off: no CO₂ anywhere; footprints already written stay." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="cs-enabled" />
      <div className="grid gap-6 md:grid-cols-3">
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">What the footprint counts</legend>{Object.keys(PART).map((k) => <Box key={k} label={PART[k][0]} hint={PART[k][1]} checked={s.parts[k as keyof Co2Settings["parts"]]} onChange={(v) => set("parts", { ...s.parts, [k]: v })} testid={`cs-part-${k}`} />)}</fieldset>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">What people see</legend>{Object.keys(SHOW).map((k) => <Box key={k} label={SHOW[k]} checked={s.show[k as keyof Co2Settings["show"]]} onChange={(v) => set("show", { ...s.show, [k]: v })} testid={`cs-show-${k}`} />)}</fieldset>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Who takes part</legend>
          <Box label="Customers see CO₂" checked={s.buyers.CUSTOMER} onChange={(v) => set("buyers", { ...s.buyers, CUSTOMER: v })} testid="cs-buyer-CUSTOMER" />
          <Box label="Wholesalers (buying) see CO₂" checked={s.buyers.WHOLESALER} onChange={(v) => set("buyers", { ...s.buyers, WHOLESALER: v })} testid="cs-buyer-WHOLESALER" />
          <Box label="Wholesalers may enter their own values" checked={s.suppliers.WHOLESALER} onChange={(v) => set("suppliers", { ...s.suppliers, WHOLESALER: v })} testid="cs-supplier-WHOLESALER" />
          <Box label="Distributors may enter their own values" checked={s.suppliers.DISTRIBUTOR} onChange={(v) => set("suppliers", { ...s.suppliers, DISTRIBUTOR: v })} testid="cs-supplier-DISTRIBUTOR" />
          <div><Label htmlFor="cs-approval">Suppliers&apos; values</Label><Select id="cs-approval" value={s.approval} onChange={(e) => set("approval", e.target.value as "ALWAYS" | "AUTO")} data-testid="cs-approval"><option value="ALWAYS">FIRINGI checks each one</option><option value="AUTO">Used at once</option></Select></div>
        </fieldset>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {num("lowPct", "“Low CO₂” at most (% of category)", "10–100")}
        {num("localKm", "“Local” within (km)")}
        {num("roadFactor", "Road distance factor", "× straight line (1–2)")}
        {num("fallbackKgPerKg", "Fallback kg CO₂e / kg")}
        {num("fallbackUnitKg", "Fallback kg per item", "When a pack has no net weight")}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <fieldset><legend className="mb-2 text-sm font-medium">Delivery: kg CO₂e per tonne-km</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{FUELS.map((f) => <div key={f}><Label className="text-xs">{f.toLowerCase()}</Label><Input type="number" step="0.01" value={s.fuels[f]} onChange={(e) => set("fuels", { ...s.fuels, [f]: Number(e.target.value) })} data-testid={`cs-fuel-${f}`} /></div>)}
            <div><Label className="text-xs">Vehicles without a fuel</Label><Select value={s.defaultFuel} onChange={(e) => set("defaultFuel", e.target.value as Co2Settings["defaultFuel"])}>{FUELS.map((f) => <option key={f} value={f}>{f.toLowerCase()}</option>)}</Select></div>
          </div>
        </fieldset>
        <fieldset><legend className="mb-2 text-sm font-medium">Packaging: kg CO₂e per item</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{PACKAGINGS.map((p) => <div key={p}><Label className="text-xs">{p.toLowerCase()}</Label><Input type="number" step="0.001" value={s.packaging[p]} onChange={(e) => set("packaging", { ...s.packaging, [p]: Number(e.target.value) })} data-testid={`cs-pack-${p}`} /></div>)}</div>
        </fieldset>
      </div>
      <Button type="submit" disabled={pending} data-testid="cs-save"><Spin on={pending} icon={Save} /> Save settings</Button>
      <Msg error={error} done={done} />
    </form>
  );
}
