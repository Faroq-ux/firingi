"use client";
/** FIRINGI (English): who may print shelf price labels and what may be on them; per-country and per-business switches. */
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveShelfLabelSettingsAction, setCompanyShelfLabelsAction } from "@/server/actions/shelf-labels";
import { findTenderBusinessAction } from "@/server/actions/tenders";
import type { ShelfLabelSettings } from "@/lib/shelf-labels";

function Box({ label, hint, checked, onChange, testid }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}

export function ShelfLabelSettingsForm({ initial, countries }: { initial: ShelfLabelSettings; countries: { code: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const off = new Set(s.offCountries);
  return (
    <form className="space-y-5" data-testid="sla-form" onSubmit={(e) => { e.preventDefault(); const { companies: _c, ...rest } = s; void _c; run(() => saveShelfLabelSettingsAction(rest), undefined, "Saved."); }}>
      <Box label="Shelf price labels on" hint="Shops print price labels for their shelves from what they buy on FIRINGI or from their FIRINGI till." checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} testid="sla-enabled" />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Who</h3>
        <Box label="Customers (shops, restaurants, cafés)" checked={s.buyers.CUSTOMER} onChange={(v) => setS({ ...s, buyers: { ...s.buyers, CUSTOMER: v } })} testid="sla-customers" />
        <Box label="Wholesalers (cash & carry counters)" checked={s.buyers.WHOLESALER} onChange={(v) => setS({ ...s, buyers: { ...s.buyers, WHOLESALER: v } })} testid="sla-wholesalers" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">What a label may show</h3>
        <p className="text-xs text-muted-foreground">Always: name, price incl. VAT, price per kg / litre, the product&apos;s own barcode.</p>
        <Box label="Brand" checked={s.allowBrand} onChange={(v) => setS({ ...s, allowBrand: v })} testid="sla-brand" />
        <Box label="Origin country" hint="From the product's origin on FIRINGI; shops can correct it." checked={s.allowOrigin} onChange={(v) => setS({ ...s, allowOrigin: v })} testid="sla-origin" />
        <Box label="QR code" hint="Opens the product's food information (allergens, ingredients). Also used when a product has no barcode." checked={s.allowQr} onChange={(v) => setS({ ...s, allowQr: v })} testid="sla-qr" />
        <Box label="Shops can set their own label size" hint="Width × height in mm on A4 sticker sheets (margins and gaps) or label-printer rolls, with a test print to check alignment. Off: only the standard sizes." checked={s.allowCustomSize} onChange={(v) => setS({ ...s, allowCustomSize: v })} testid="sla-customsize" />
        <Box label="Save the price into the shop's FIRINGI till" checked={s.allowPosSync} onChange={(v) => setS({ ...s, allowPosSync: v })} testid="sla-possync" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Countries</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {countries.map((c) => <label key={c.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!off.has(c.code)} onChange={(e) => setS({ ...s, offCountries: e.target.checked ? s.offCountries.filter((x) => x !== c.code) : [...s.offCountries, c.code] })} data-testid={`sla-country-${c.code}`} /> {c.name} <span className="text-xs text-muted-foreground">{c.code}</span></label>)}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="sla-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function ShelfLabelCompanySwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Shelf labels for this business" value={state} disabled={pending} className="h-8 w-44" data-testid="sla-company"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setCompanyShelfLabelsAction({ companyId, value: v === "DEFAULT" ? null : v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (settings)</option><option value="ON">Always on</option><option value="OFF">Always off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function FindShopForLabels() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits((r.data as typeof hits).filter((h) => h.type === "CUSTOMER" || h.type === "WHOLESALER")); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a shop or wholesaler by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sla-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="sla-hit"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><ShelfLabelCompanySwitch companyId={h.id} state="DEFAULT" /></li>)}</ul>}
    </div>
  );
}
