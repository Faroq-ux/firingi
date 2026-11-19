"use client";
/** Phase 47 — FIRINGI's till settings (English): master switch, per company type, per country (fiscal stage + provider), features; per-company switch. */
import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { POS_FEATURE_LABEL, POS_FEATURES, POS_PROVIDER_INFO, POS_PROVIDERS, POS_TYPES, type PosSettings } from "@/lib/pos";
import { decideTillAction, savePosSettingsAction, setPosCompanyStateAction } from "@/server/actions/pos";

const TYPE_LABEL = { DISTRIBUTOR: "Distributors", WHOLESALER: "Wholesalers", CUSTOMER: "Wholesale customers (restaurants, shops)" } as const;

export function PosSettingsForm({ initial, countryNames }: { initial: PosSettings; countryNames: Record<string, string> }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState<PosSettings>(initial);
  const box = (label: string, checked: boolean, on: (v: boolean) => void, testid?: string) => (
    <label className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 shrink-0" checked={checked} onChange={(e) => on(e.target.checked)} data-testid={testid} /> <span className="min-w-0">{label}</span></label>
  );
  const setC = (cc: string, p: Partial<PosSettings["countries"][string]>) => setX({ ...x, countries: { ...x.countries, [cc]: { ...x.countries[cc], ...p } } });
  return (
    <div className="space-y-6" data-testid="pos-admin-settings">
      <section className="space-y-2">
        {box("The till (POS) is available on FIRINGI", x.enabled, (v) => setX({ ...x, enabled: v }), "ps-enabled")}
        <h3 className="pt-2 text-sm font-semibold">Who gets it</h3>
        <div className="grid gap-2 sm:grid-cols-3">{POS_TYPES.map((tp) => box(TYPE_LABEL[tp], x.types[tp], (v) => setX({ ...x, types: { ...x.types, [tp]: v } }), `ps-type-${tp}`))}</div>
        <p className="text-xs text-muted-foreground">Each company can still be switched on or off by itself under Till per Company.</p>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Features</h3>
        <div className="grid gap-2 sm:grid-cols-2">{POS_FEATURES.map((f) => box(POS_FEATURE_LABEL[f], x.features[f], (v) => setX({ ...x, features: { ...x.features, [f]: v } }), `ps-f-${f}`))}</div>
        <div className="grid max-w-md gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="ps-oh">Offline: stop after (hours)</Label><Input id="ps-oh" inputMode="numeric" value={String(x.offlineHours)} onChange={(e) => setX({ ...x, offlineHours: Number(e.target.value.replace(/\D/g, "")) || 1 })} data-testid="ps-offline-hours" /></div>
          <div className="space-y-1"><Label htmlFor="ps-om">Offline: stop after (sales waiting)</Label><Input id="ps-om" inputMode="numeric" value={String(x.offlineMaxSales)} onChange={(e) => setX({ ...x, offlineMaxSales: Number(e.target.value.replace(/\D/g, "")) || 10 })} /></div>
        </div>
        <div className="max-w-md space-y-1"><Label htmlFor="ps-twa">Tills a business may open without FIRINGI&apos;s approval</Label><Input id="ps-twa" inputMode="numeric" value={String(x.tillsWithoutApproval)} onChange={(e) => setX({ ...x, tillsWithoutApproval: Number(e.target.value.replace(/\D/g, "")) })} data-testid="ps-tills-free" />
          <p className="text-xs text-muted-foreground">Each further till (another shop or warehouse) waits for FIRINGI&apos;s approval under Till per Company. 0 = every till needs approval.</p></div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Receipts per country</h3>
        <p className="text-xs text-muted-foreground"><b>Non-fiscal</b>: the till sells, keeps stock and reports; the legal receipt comes from the business&apos;s own certified till / printer. <b>Certified provider</b>: each receipt goes to the business&apos;s own account with the provider chosen here (a business that hasn&apos;t connected its account can&apos;t sell unless &quot;non-fiscal meanwhile&quot; is on).</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="ps-countries">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Country</th><th>On</th><th>Receipts</th><th>Provider</th><th>Non-fiscal meanwhile</th></tr></thead>
            <tbody>{Object.keys(x.countries).sort().map((cc) => { const c = x.countries[cc]; return (
              <tr key={cc} className="border-t" data-testid={`ps-c-${cc}`}>
                <td className="py-1.5">{countryNames[cc] ?? cc} <span className="text-xs text-muted-foreground">{cc}</span></td>
                <td><input type="checkbox" checked={c.enabled} onChange={(e) => setC(cc, { enabled: e.target.checked })} data-testid={`ps-on-${cc}`} /></td>
                <td><Select value={c.stage} onChange={(e) => setC(cc, { stage: e.target.value as "NONFISCAL" })} data-testid={`ps-stage-${cc}`}><option value="NONFISCAL">Non-fiscal</option><option value="PROVIDER">Certified provider</option></Select></td>
                <td><Select value={c.provider ?? ""} onChange={(e) => setC(cc, { provider: (e.target.value || null) as never })} data-testid={`ps-provider-${cc}`}><option value="">—</option>{POS_PROVIDERS.filter((p) => POS_PROVIDER_INFO[p].countries.includes(cc)).map((p) => <option key={p} value={p}>{POS_PROVIDER_INFO[p].name}</option>)}</Select></td>
                <td><input type="checkbox" checked={c.fallbackNonFiscal} disabled={c.stage !== "PROVIDER"} onChange={(e) => setC(cc, { fallbackNonFiscal: e.target.checked })} data-testid={`ps-fallback-${cc}`} /></td>
              </tr>
            ); })}</tbody>
          </table>
        </div>
      </section>
      <div className="flex items-center gap-3"><Button disabled={pending} onClick={() => run(() => savePosSettingsAction(x), undefined, "Saved")} data-testid="ps-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

export function CompanyStateSelect({ companyId, state }: { companyId: string; state: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Select value={state} disabled={pending} onChange={(e) => run(() => setPosCompanyStateAction({ companyId, state: e.target.value as "DEFAULT" }))} data-testid={`pcs-${companyId}`}>
        <option value="DEFAULT">Follow its type</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function TillDecision({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => decideTillAction({ id, approve: true, note: note || null }))} data-testid={`till-approve-${id}`}>Approve</Button>
      <Input className="h-8 w-44" placeholder="Reason (to refuse)" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`till-note-${id}`} />
      <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => run(() => decideTillAction({ id, approve: false, note }))} data-testid={`till-reject-${id}`}>Refuse</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
