"use client";
/** FIRINGI's pay-later and tender controls (Phase 50, English). */
import { useEffect, useState } from "react";
import { Ban, Check, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { savePayLaterSettingsAction, setOwnLimitAction, setPayLaterSwitchAction } from "@/server/actions/pay-later";
import { findTenderBusinessAction, reviewTenderAction, saveTenderSettingsAction, setTenderSwitchAction } from "@/server/actions/tenders";
import type { CountryPayLater, PayLaterSettings, PayLaterTerm } from "@/lib/pay-later";
import type { TenderSettings } from "@/lib/tenders";

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
const Num = ({ id, label, value, onChange, hint, step = "any" }: { id: string; label: string; value: number; onChange: (n: number) => void; hint?: string; step?: string }) => (
  <div><Label htmlFor={id}>{label}</Label><Input id={id} type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={id} />{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
);

function ModelPicker({ value, onChange, testid }: { value: CountryPayLater; onChange: (v: CountryPayLater) => void; testid: string }) {
  return (
    <span className="flex flex-wrap items-center gap-3 text-sm" data-testid={testid}>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={value.partner} onChange={(e) => onChange({ ...value, partner: e.target.checked })} /> Gateway partner</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={value.own} onChange={(e) => onChange({ ...value, own: e.target.checked })} /> FIRINGI&apos;s own credit</label>
      <Select aria-label="Offered first" className="h-8 w-44" value={value.first} onChange={(e) => onChange({ ...value, first: e.target.value as "PARTNER" | "OWN" })}><option value="PARTNER">Partner first</option><option value="OWN">Own credit first</option></Select>
    </span>
  );
}

export function PayLaterSettingsForm({ initial, countries }: { initial: PayLaterSettings; countries: { code: string; name: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof PayLaterSettings>(k: K, v: PayLaterSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setTerm = (i: number, p: Partial<PayLaterTerm>) => set("terms", s.terms.map((t, k) => (k === i ? { ...t, ...p } : t)));
  const [addCountry, setAddCountry] = useState("");
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => savePayLaterSettingsAction(s), undefined, "Saved."); }} data-testid="pls-form">
      <Box label="Pay later is on" hint="Off: buyers don't see pay later at checkout. Plans already running carry on." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="pls-enabled" />
      <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Who can pay later</legend>
        <Box label="Customers (restaurants, shops…)" checked={s.buyers.CUSTOMER} onChange={(v) => set("buyers", { ...s.buyers, CUSTOMER: v })} testid="pls-buyer-CUSTOMER" />
        <Box label="Wholesalers (buying from distributors)" checked={s.buyers.WHOLESALER} onChange={(v) => set("buyers", { ...s.buyers, WHOLESALER: v })} testid="pls-buyer-WHOLESALER" />
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Terms</legend>
        <p className="text-xs text-muted-foreground">Fee = % of the order&apos;s gross + a fixed amount. Who pays it: the buyer (a VAT-exempt line on its invoice), FIRINGI, or shared.</p>
        <div className="space-y-2" data-testid="pls-terms">
          {s.terms.map((t, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border p-2 text-sm sm:grid-cols-4 lg:grid-cols-8" data-testid="pls-term">
              <label className="col-span-2 flex items-center gap-2 sm:col-span-1"><input type="checkbox" checked={t.enabled} onChange={(e) => setTerm(i, { enabled: e.target.checked })} data-testid="pls-term-on" /> On</label>
              <div><Label>Kind</Label><Select value={t.kind} onChange={(e) => setTerm(i, { kind: e.target.value as PayLaterTerm["kind"], days: e.target.value === "DAYS" ? t.days || 30 : 0, count: e.target.value === "INSTALMENTS" ? t.count || 3 : 0 })}><option value="DAYS">Days</option><option value="INSTALMENTS">Monthly instalments</option></Select></div>
              {t.kind === "DAYS" ? <div><Label>Days</Label><Input type="number" value={t.days} onChange={(e) => setTerm(i, { days: Number(e.target.value) })} /></div> : <div><Label>Instalments</Label><Input type="number" value={t.count} onChange={(e) => setTerm(i, { count: Number(e.target.value) })} /></div>}
              <div><Label>Fee %</Label><Input type="number" step="0.1" value={t.feePct} onChange={(e) => setTerm(i, { feePct: Number(e.target.value) })} data-testid="pls-term-pct" /></div>
              <div><Label>Fixed €</Label><Input type="number" step="0.01" value={t.feeFixed} onChange={(e) => setTerm(i, { feeFixed: Number(e.target.value) })} /></div>
              <div><Label>Fee paid by</Label><Select value={t.feePayer} onChange={(e) => setTerm(i, { feePayer: e.target.value as PayLaterTerm["feePayer"] })} data-testid="pls-term-payer"><option value="BUYER">Buyer</option><option value="FIRINGI">FIRINGI</option><option value="SHARED">Shared</option></Select></div>
              {t.feePayer === "SHARED" ? <div><Label>Buyer&apos;s share %</Label><Input type="number" value={t.buyerSharePct} onChange={(e) => setTerm(i, { buyerSharePct: Number(e.target.value) })} /></div> : <div />}
              <Button type="button" variant="ghost" size="sm" aria-label="Remove term" onClick={() => set("terms", s.terms.filter((_, k) => k !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => set("terms", [...s.terms, { id: `t${Date.now().toString(36).slice(-5)}`, kind: "DAYS", days: 120, count: 0, enabled: false, feePct: 4, feeFixed: 0, feePayer: "BUYER", buyerSharePct: 50 }])} data-testid="pls-add-term"><Plus className="size-4" /> Add a term</Button>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Who finances it, per country</legend>
        <p className="text-xs text-muted-foreground">Gateway partner: the payment gateway&apos;s &quot;buy now, pay later&quot; checks the buyer, pays FIRINGI when the invoice is issued and collects from the buyer (its risk). Own credit: FIRINGI waits for the buyer&apos;s payments (FIRINGI&apos;s risk, within each buyer&apos;s limit). When the first declines, the other is tried.</p>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-2"><span className="w-32 text-sm font-medium">Every country</span><ModelPicker value={s.defaults} onChange={(v) => set("defaults", v)} testid="pls-default-models" /></div>
        {Object.entries(s.countries).map(([code, v]) => (
          <div key={code} className="flex flex-wrap items-center gap-3 rounded-lg border p-2" data-testid="pls-country">
            <span className="w-32 text-sm font-medium">{countries.find((c) => c.code === code)?.name ?? code}</span>
            <ModelPicker value={v} onChange={(nv) => set("countries", { ...s.countries, [code]: nv })} testid={`pls-models-${code}`} />
            <Button type="button" variant="ghost" size="sm" aria-label="Use the default" onClick={() => { const c = { ...s.countries }; delete c[code]; set("countries", c); }}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Country" className="h-9 w-56" value={addCountry} onChange={(e) => setAddCountry(e.target.value)} data-testid="pls-add-country"><option value="">A country of its own…</option>{countries.filter((c) => !s.countries[c.code]).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
          <Button type="button" size="sm" variant="outline" disabled={!addCountry} onClick={() => { set("countries", { ...s.countries, [addCountry]: { ...s.defaults } }); setAddCountry(""); }} data-testid="pls-add-country-btn"><Plus className="size-4" /> Add</Button>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Num id="pls-ownLimit-CUSTOMER" label="Own credit — customer limit (€)" value={s.ownLimit.CUSTOMER} onChange={(n) => set("ownLimit", { ...s.ownLimit, CUSTOMER: n })} />
        <Num id="pls-ownLimit-WHOLESALER" label="Own credit — wholesaler limit (€)" value={s.ownLimit.WHOLESALER} onChange={(n) => set("ownLimit", { ...s.ownLimit, WHOLESALER: n })} />
        <Num id="pls-minOrder" label="Smallest order (€, gross)" value={s.minOrder} onChange={(n) => set("minOrder", n)} />
        <Num id="pls-remindDays" label="Remind before a payment (days)" value={s.remindDays} onChange={(n) => set("remindDays", n)} step="1" />
      </div>
      <Button type="submit" disabled={pending} data-testid="pls-save"><Spin on={pending} icon={Save} /> Save settings</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

function Switch({ action, companyId, state: initial, label, testid }: { action: (i: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) => Promise<{ ok: boolean; error?: string }>; companyId: string; state: "DEFAULT" | "ON" | "OFF"; label: string; testid: string }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label={label} value={state} disabled={pending} className="h-8 w-40" data-testid={testid}
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await action({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}
export const PayLaterSwitch = (p: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) => <Switch {...p} action={setPayLaterSwitchAction} label="Pay later for this business" testid="pls-switch" />;
export const TenderSwitch = (p: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) => <Switch {...p} action={setTenderSwitchAction} label="Tenders for this business" testid="tds-switch" />;

export function OwnLimit({ companyId, limit, fallback }: { companyId: string; limit: number | null; fallback: number }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(limit == null ? "" : String(limit));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input aria-label="Own credit limit (€)" className="h-8 w-28" type="number" placeholder={String(fallback)} value={v} onChange={(e) => setV(e.target.value)} data-testid="pls-own-limit" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setOwnLimitAction({ companyId, limit: v === "" ? null : Number(v) }), undefined, "Saved.")}><Check className="size-4" /></Button>
      <Msg error={error} done={done} />
    </span>
  );
}

/** Find a business and give it its own switch (and, for pay later, its own limit). */
export function FindBusiness({ kind, types }: { kind: "paylater" | "tenders"; types: string[] }) {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findTenderBusinessAction({ q }); if (r.ok) setHits((r.data as typeof hits).filter((h) => types.includes(h.type))); }, 250);
    return () => clearTimeout(t);
  }, [q, types]);
  const TYPE: Record<string, string> = { CUSTOMER: "Customer", WHOLESALER: "Wholesaler", DISTRIBUTOR: "Distributor" };
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${kind}-find`} />
      {hits.length > 0 && (
        <ul className="divide-y rounded-lg border" data-testid={`${kind}-find-hits`}>
          {hits.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {TYPE[h.type] ?? h.type}</span></span>
              {kind === "paylater" ? <><PayLaterSwitch companyId={h.id} state="DEFAULT" /><OwnLimit companyId={h.id} limit={null} fallback={0} /></> : <TenderSwitch companyId={h.id} state="DEFAULT" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReviewTender({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="tds-review">
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewTenderAction({ id, approve: true, note: note || null }))} data-testid="tds-approve"><Check className="size-4" /> Approve</Button>
      <Input aria-label="Reason" placeholder="Reason (to turn down — the buyer sees it)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-64 max-w-full" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewTenderAction({ id, approve: false, note }))} data-testid="tds-reject"><Ban className="size-4" /> Turn down</Button>
      <Msg error={error} />
    </span>
  );
}

export function TenderSettingsForm({ initial }: { initial: TenderSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof TenderSettings>(k: K, v: TenderSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => saveTenderSettingsAction(s), undefined, "Saved."); }} data-testid="tds-form">
      <Box label="Open tenders are on" hint="Off: no new tenders and no bids; tenders already awarded keep their orders." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="tds-enabled" />
      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Who posts tenders</legend>
          <Box label="Customers (restaurants, shops…)" checked={s.buyers.CUSTOMER} onChange={(v) => set("buyers", { ...s.buyers, CUSTOMER: v })} testid="tds-buyer-CUSTOMER" />
          <Box label="Wholesalers (buying from distributors)" checked={s.buyers.WHOLESALER} onChange={(v) => set("buyers", { ...s.buyers, WHOLESALER: v })} testid="tds-buyer-WHOLESALER" />
        </fieldset>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Who bids</legend>
          <Box label="Wholesalers (on customers' tenders, own country)" checked={s.suppliers.WHOLESALER} onChange={(v) => set("suppliers", { ...s.suppliers, WHOLESALER: v })} testid="tds-supplier-WHOLESALER" />
          <Box label="Distributors (on wholesalers' tenders)" checked={s.suppliers.DISTRIBUTOR} onChange={(v) => set("suppliers", { ...s.suppliers, DISTRIBUTOR: v })} testid="tds-supplier-DISTRIBUTOR" />
        </fieldset>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Options</legend>
          <Box label="Buyers may invite chosen suppliers only" checked={s.invitations} onChange={(v) => set("invitations", v)} testid="tds-invitations" />
          <Box label="Buyers may show a target price per line" checked={s.targetPrices} onChange={(v) => set("targetPrices", v)} testid="tds-targetPrices" />
          <Box label="Pay later at the award (when pay later is on)" checked={s.payLater} onChange={(v) => set("payLater", v)} testid="tds-payLater" />
        </fieldset>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div><Label htmlFor="tds-approval">New tenders</Label><Select id="tds-approval" value={s.approval} onChange={(e) => set("approval", e.target.value as "ALWAYS" | "AUTO")} data-testid="tds-approval"><option value="AUTO">Open at once</option><option value="ALWAYS">FIRINGI checks each one</option></Select></div>
        <Num id="tds-maxLines" label="Lines per tender" value={s.maxLines} onChange={(n) => set("maxLines", n)} step="1" />
        <Num id="tds-minHours" label="Shortest bidding (hours)" value={s.minHours} onChange={(n) => set("minHours", n)} step="1" />
        <Num id="tds-maxDays" label="Longest bidding (days)" value={s.maxDays} onChange={(n) => set("maxDays", n)} step="1" />
        <Num id="tds-awardDays" label="Days to award after closing" value={s.awardDays} onChange={(n) => set("awardDays", n)} step="1" />
      </div>
      <Button type="submit" disabled={pending} data-testid="tds-save"><Spin on={pending} icon={Save} /> Save settings</Button>
      <Msg error={error} done={done} />
    </form>
  );
}
