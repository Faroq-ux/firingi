"use client";
/** FIRINGI's switches (English): supplier minimums help, and whether buyers see supplier names or "FIRINGI <area>". */
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveCartHelpAction, saveSupplierNamesAction, setSupplierNameModeAction } from "@/server/actions/cart-help";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { CartHelpSettings, NameMode, SupplierNameSettings } from "@/lib/cart-help";

function Box({ label, hint, checked, onChange, testid }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
const MODES: { v: NameMode; label: string }[] = [{ v: "NAME", label: "Show the supplier's name" }, { v: "AREA", label: "Show “FIRINGI + area” (e.g. FIRINGI Almada)" }];

export function CartHelpForm({ initial, countries }: { initial: CartHelpSettings; countries: { code: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const off = new Set(s.offCountries);
  return (
    <form className="space-y-5" data-testid="ch-form" onSubmit={(e) => { e.preventDefault(); run(() => saveCartHelpAction(s), undefined, "Saved."); }}>
      <Box label="Help customers reach each supplier's minimum" hint="Only where customers choose their suppliers (not in FIRINGI ordering mode)." checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} testid="ch-enabled" />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Parts</h3>
        <Box label="Suppliers already in the cart first" hint="In search and scan results; then the suppliers the customer usually orders from." checked={s.cartFirst} onChange={(v) => setS({ ...s, cartFirst: v })} testid="ch-cartfirst" />
        <Box label="Minimum badges on results" hint="“In your cart · €12 more to reach the minimum”, “Minimum order €100”, “Free delivery from €150”." checked={s.badges} onChange={(v) => setS({ ...s, badges: v })} testid="ch-badges" />
        <Box label="Suggestions in the cart" hint="For a supplier below its minimum: what the customer usually buys from it, one tap to add." checked={s.suggestions} onChange={(v) => setS({ ...s, suggestions: v })} testid="ch-suggestions" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Countries</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
          {countries.map((c) => <label key={c.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!off.has(c.code)} onChange={(e) => setS({ ...s, offCountries: e.target.checked ? s.offCountries.filter((x) => x !== c.code) : [...s.offCountries, c.code] })} data-testid={`ch-country-${c.code}`} /> {c.name} <span className="text-xs text-muted-foreground">{c.code}</span></label>)}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="ch-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function SupplierNamesForm({ initial, countries }: { initial: SupplierNameSettings; countries: { code: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  return (
    <form className="space-y-5" data-testid="sn-form" onSubmit={(e) => { e.preventDefault(); run(() => saveSupplierNamesAction({ customers: s.customers, wholesalers: s.wholesalers, countries: s.countries }), undefined, "Saved."); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="font-semibold">Customers see</span>
          <Select value={s.customers} onChange={(e) => setS({ ...s, customers: e.target.value as NameMode })} data-testid="sn-customers">{MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}</Select></label>
        <label className="space-y-1 text-sm"><span className="font-semibold">Wholesalers buying from distributors see</span>
          <Select value={s.wholesalers} onChange={(e) => setS({ ...s, wholesalers: e.target.value as NameMode })} data-testid="sn-wholesalers">{MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}</Select></label>
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Per customer country</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {countries.map((c) => (
            <label key={c.code} className="flex items-center gap-2 text-sm"><span className="w-28 shrink-0 truncate">{c.name}</span>
              <Select className="h-8" value={s.countries[c.code] ?? ""} onChange={(e) => { const countries = { ...s.countries }; if (e.target.value) countries[c.code] = e.target.value as NameMode; else delete countries[c.code]; setS({ ...s, countries }); }} data-testid={`sn-country-${c.code}`}>
                <option value="">As above</option><option value="NAME">Name</option><option value="AREA">FIRINGI + area</option>
              </Select></label>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="sn-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function SupplierNameSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | NameMode }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="What buyers see for this supplier" value={state} disabled={pending} className="h-8 w-48" data-testid="sn-company"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setSupplierNameModeAction({ companyId, value: v === "DEFAULT" ? null : v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (settings)</option><option value="NAME">Always its name</option><option value="AREA">Always FIRINGI + area</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function FindSupplierForName() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits((r.data as typeof hits).filter((h) => h.type === "DISTRIBUTOR" || h.type === "WHOLESALER")); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a supplier by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sn-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="sn-hit"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><SupplierNameSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}
