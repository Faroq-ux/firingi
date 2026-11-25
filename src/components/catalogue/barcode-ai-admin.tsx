"use client";
/** FIRINGI's switches for "Add by barcode with AI" (English): on/off, suppliers, parts, countries, companies. */
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveBarcodeAiSettingsAction, setCompanyBarcodeAiAction } from "@/server/actions/barcode-ai";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { BarcodeAiSettings } from "@/lib/barcode-ai";

function Box({ label, hint, checked, onChange, testid }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}

export function BarcodeAiForm({ initial, countries }: { initial: BarcodeAiSettings; countries: { code: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const off = new Set(s.offCountries);
  return (
    <form className="space-y-6" data-testid="ba-form" onSubmit={(e) => { e.preventDefault(); run(() => saveBarcodeAiSettingsAction({ enabled: s.enabled, sellers: s.sellers, parts: s.parts, offCountries: s.offCountries, hourlyLimit: s.hourlyLimit }), undefined, "Saved."); }}>
      <Box label="Add by barcode with AI is on" hint="Off: the box disappears from every supplier's My products page." checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} testid="ba-enabled" />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Who can use it</h3>
        <Box label="Distributors" checked={s.sellers.DISTRIBUTOR} onChange={(v) => setS({ ...s, sellers: { ...s.sellers, DISTRIBUTOR: v } })} testid="ba-dist" />
        <Box label="Wholesalers" checked={s.sellers.WHOLESALER} onChange={(v) => setS({ ...s, sellers: { ...s.sellers, WHOLESALER: v } })} testid="ba-whs" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Parts</h3>
        <Box label="Look the barcode up in the open product databases" hint="Open Food Facts, Open Beauty Facts, Open Pet Food Facts and Open Products Facts — free, all categories." checked={s.parts.lookup} onChange={(v) => setS({ ...s, parts: { ...s.parts, lookup: v } })} testid="ba-lookup" />
        <Box label="AI fills in the form" hint="FIRINGI category, VAT, unit and pack, names in English and Portuguese, description, allergens for food. Off: the database data is mapped by simple rules." checked={s.parts.ai} onChange={(v) => setS({ ...s, parts: { ...s.parts, ai: v } })} testid="ba-ai" />
        <Box label="AI reads photos of the package" hint="When the barcode isn't in any database. Needs the AI part on." checked={s.parts.photos} onChange={(v) => setS({ ...s, parts: { ...s.parts, photos: v } })} testid="ba-photos-part" />
        <div className="max-w-[12rem] space-y-1 pt-1"><Label htmlFor="ba-limit" className="text-xs">Lookups per supplier per hour</Label><Input id="ba-limit" type="number" min={1} max={1000} value={s.hourlyLimit} onChange={(e) => setS({ ...s, hourlyLimit: Number(e.target.value) })} data-testid="ba-limit" /></div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Countries</h3>
        <p className="text-xs text-muted-foreground">Untick a country to switch it off for all suppliers there (a company switched on below still can).</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4" data-testid="ba-countries">
          {countries.map((c) => (
            <label key={c.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!off.has(c.code)} onChange={(e) => setS({ ...s, offCountries: e.target.checked ? s.offCountries.filter((x) => x !== c.code) : [...s.offCountries, c.code] })} data-testid={`ba-country-${c.code}`} /> {c.name} <span className="text-xs text-muted-foreground">{c.code}</span></label>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="ba-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function CompanyBarcodeAiSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Add by barcode for this company" value={state} disabled={pending} className="h-8 w-44" data-testid="ba-company"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setCompanyBarcodeAiAction({ companyId, value: v === "DEFAULT" ? null : v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (settings)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}
export function FindBarcodeAiCompany() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits((r.data as typeof hits).filter((h) => h.type === "DISTRIBUTOR" || h.type === "WHOLESALER")); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a supplier by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="ba-find-company" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="ba-hit"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><CompanyBarcodeAiSwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}
