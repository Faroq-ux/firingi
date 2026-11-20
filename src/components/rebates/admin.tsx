"use client";
/** FIRINGI's rebate & bonus controls (Phase 48, English). */
import { useState } from "react";
import { Ban, Check, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { retryRebatesAction, reviewBonusAction, saveRebateSettingsAction, setSupplierSwitchAction } from "@/server/actions/rebates";
import { REBATE_KINDS, REBATE_PERIODS, type RebateSettings } from "@/lib/rebates";

const KIND: Record<string, string> = { VOLUME: "Volume rebate (tiers)", FREE_GOODS: "Free goods (buy X get Y)", GROWTH: "Growth bonus (vs last year)", MIX: "Product mix / listing bonus" };
const PERIOD: Record<string, string> = { MONTH: "Monthly", QUARTER: "Quarterly", HALF_YEAR: "Half-yearly", YEAR: "Yearly" };
const AUD: Record<string, string> = { ALL: "All customers", SEGMENT: "CRM segments", GROUP: "Customer groups", COMPANIES: "Chosen customers", COUNTRY: "Limit to countries", PER_SHOP: "Count each shop on its own" };

export function ReviewBonus({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="rb-review">
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewBonusAction({ id, approve: true, note: note || null }))} data-testid="rb-approve"><Check className="size-4" /> Approve</Button>
      <Input aria-label="Reason" placeholder="Reason (to turn down — the supplier sees it)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-64 max-w-full" data-testid="rb-review-note" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewBonusAction({ id, approve: false, note }))} data-testid="rb-reject"><Ban className="size-4" /> Turn down</Button>
      <Msg error={error} />
    </span>
  );
}

export function SupplierSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Rebates for this supplier" value={state} disabled={pending} className="h-8 w-40" data-testid="rb-switch"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setSupplierSwitchAction({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function RetryFailed({ n }: { n: number }) {
  const { pending, error, done, run } = useRun();
  if (!n) return null;
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryRebatesAction({}), undefined, "Retried.")} data-testid="rb-retry"><Spin on={pending} icon={RefreshCw} /> Retry {n} failed</Button><Msg error={error} done={done} /></span>;
}

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}

export function RebateSettingsForm({ initial }: { initial: RebateSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof RebateSettings>(k: K, v: RebateSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const num = (k: "maxPct" | "maxFixed" | "freeGoodsDays" | "settleDelayDays" | "nudgeDays", label: string, hint?: string) => (
    <div><Label htmlFor={`rs-${k}`}>{label}</Label><Input id={`rs-${k}`} type="number" step="any" value={s[k]} onChange={(e) => set(k, Number(e.target.value))} data-testid={`rs-${k}`} />{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
  );
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => saveRebateSettingsAction(s), undefined, "Saved."); }} data-testid="rs-form">
      <Box label="Rebates & bonuses are on" hint="Off: no new deals and buyers don't see running ones. Periods already earned are still settled." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="rs-enabled" />
      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Kinds of deal</legend>{REBATE_KINDS.map((k) => <Box key={k} label={KIND[k]} checked={s.kinds[k]} onChange={(v) => set("kinds", { ...s.kinds, [k]: v })} testid={`rs-kind-${k}`} />)}</fieldset>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Periods</legend>{REBATE_PERIODS.map((k) => <Box key={k} label={PERIOD[k]} checked={s.periods[k]} onChange={(v) => set("periods", { ...s.periods, [k]: v })} />)}</fieldset>
        <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Who a deal can be for</legend>{(Object.keys(AUD) as (keyof RebateSettings["audiences"])[]).map((k) => <Box key={k} label={AUD[k]} checked={s.audiences[k]} onChange={(v) => set("audiences", { ...s.audiences, [k]: v })} testid={`rs-aud-${k}`} />)}</fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Who takes part</legend>
          <Box label="Distributors may create deals" checked={s.creators.DISTRIBUTOR} onChange={(v) => set("creators", { ...s.creators, DISTRIBUTOR: v })} testid="rs-creator-DISTRIBUTOR" />
          <Box label="Wholesalers may create deals" checked={s.creators.WHOLESALER} onChange={(v) => set("creators", { ...s.creators, WHOLESALER: v })} testid="rs-creator-WHOLESALER" />
          <Box label="Customers (restaurants, shops…) can earn" checked={s.buyers.CUSTOMER} onChange={(v) => set("buyers", { ...s.buyers, CUSTOMER: v })} />
          <Box label="Wholesalers (buying from distributors) can earn" checked={s.buyers.WHOLESALER} onChange={(v) => set("buyers", { ...s.buyers, WHOLESALER: v })} />
          <Box label="FIRINGI may run deals it pays for itself" checked={s.firingiFunded} onChange={(v) => set("firingiFunded", v)} />
        </fieldset>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><Label htmlFor="rs-approval">Approval</Label>
          <Select id="rs-approval" value={s.approval} onChange={(e) => set("approval", e.target.value as "ALWAYS" | "AUTO")} data-testid="rs-approval"><option value="ALWAYS">FIRINGI approves every deal</option><option value="AUTO">Deals within the limits start by themselves</option></Select>
        </div>
        {num("maxPct", "Highest % per step", "0.5–50 %")}
        {num("maxFixed", "Highest fixed bonus (€)")}
        {num("freeGoodsDays", "Default days to take free goods", "7–365")}
        {num("settleDelayDays", "Days after a period before settling", "Late deliveries and returns still count (0–30).")}
        <div className="space-y-2"><Box label="Remind customers close to the next step" checked={s.nudge} onChange={(v) => set("nudge", v)} />{num("nudgeDays", "…in the last days of a period")}</div>
      </div>
      <Button type="submit" disabled={pending} data-testid="rs-save"><Spin on={pending} icon={Save} /> Save settings</Button>
      <Msg error={error} done={done} />
    </form>
  );
}
