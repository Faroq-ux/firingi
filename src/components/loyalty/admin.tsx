"use client";
/** FIRINGI's loyalty controls (Phase 32, English): rules, tiers, referral, campaigns, manual points, run now. */
import { useState } from "react";
import { Play, Save, Sparkles, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { adjustPointsAction, endCampaignAction, runLoyaltyNowAction, saveCampaignAction, saveLoyaltySettingsAction } from "@/server/actions/loyalty";
import type { LoyaltySettings } from "@/server/loyalty/service";

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

export function LoyaltySettingsForm({ settings, canManage }: { settings: LoyaltySettings; canManage: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const field = (k: keyof LoyaltySettings, label: string, hint?: string, step = "1") => (
    <div className="space-y-1">
      <Label htmlFor={`ls-${k}`}>{label}</Label>
      <Input id={`ls-${k}`} type="number" step={step} value={String(v[k])} disabled={!canManage} onChange={(e) => setV({ ...v, [k]: num(e.target.value) })} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  const tier = (t: "BRONZE" | "SILVER" | "GOLD", label: string) => (
    <fieldset className="space-y-2 rounded-xl border p-3" data-testid={`tier-${t}`}>
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label htmlFor={`t-${t}-spend`}>From (€ / 12 months)</Label><Input id={`t-${t}-spend`} type="number" value={String(v.tiers[t].minSpend)} disabled={!canManage || t === "BRONZE"} onChange={(e) => setV({ ...v, tiers: { ...v.tiers, [t]: { ...v.tiers[t], minSpend: num(e.target.value) } } })} /></div>
        <div className="space-y-1"><Label htmlFor={`t-${t}-mult`}>Points ×</Label><Input id={`t-${t}-mult`} type="number" step="0.05" value={String(v.tiers[t].multiplier)} disabled={!canManage} onChange={(e) => setV({ ...v, tiers: { ...v.tiers, [t]: { ...v.tiers[t], multiplier: num(e.target.value) } } })} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.tiers[t].freeDelivery} disabled={!canManage} onChange={(e) => setV({ ...v, tiers: { ...v.tiers, [t]: { ...v.tiers[t], freeDelivery: e.target.checked } } })} /> Free delivery (FIRINGI pays)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.tiers[t].prioritySupport} disabled={!canManage} onChange={(e) => setV({ ...v, tiers: { ...v.tiers, [t]: { ...v.tiers[t], prioritySupport: e.target.checked } } })} /> Priority support</label>
    </fieldset>
  );
  return (
    <div className="space-y-4" data-testid="loyalty-settings">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={v.enabled} disabled={!canManage} onChange={(e) => setV({ ...v, enabled: e.target.checked })} data-testid="loyalty-enabled" /> Loyalty programme on (customers and wholesalers; per company in Settings › Business Features)</label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("pointsPerEuro", "Points per € (delivered goods, net)", undefined, "0.1")}
        {field("pointValue", "Value of 1 point (€)", `${Math.round(1 / (v.pointValue || 1))} points = 1 €`, "0.001")}
        {field("minRedeem", "Minimum points at checkout")}
        {field("maxRedeemPct", "Max. share of an order paid with points (%)")}
        {field("creditNoteMin", "Minimum points for a credit note")}
        {field("expiryMonths", "Points expire after (months)")}
        {field("reminderDays", "Reminder before expiry (days)")}
      </div>
      <div className="max-w-xs space-y-1">
        <Label htmlFor="ls-startsOn">Points for orders delivered from</Label>
        <Input id="ls-startsOn" type="date" value={v.startsOn ?? ""} disabled={!canManage} onChange={(e) => setV({ ...v, startsOn: e.target.value || null })} />
        <p className="text-xs text-muted-foreground">Set automatically the first time loyalty runs, so older orders don&apos;t earn points.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">{tier("BRONZE", "Bronze")}{tier("SILVER", "Silver")}{tier("GOLD", "Gold")}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="ref-inviter">Referral: points for the business that invites</Label><Input id="ref-inviter" type="number" value={String(v.referral.inviter)} disabled={!canManage} onChange={(e) => setV({ ...v, referral: { ...v.referral, inviter: num(e.target.value) } })} /></div>
        <div className="space-y-1"><Label htmlFor="ref-invited">Referral: points for the invited business</Label><Input id="ref-invited" type="number" value={String(v.referral.invited)} disabled={!canManage} onChange={(e) => setV({ ...v, referral: { ...v.referral, invited: num(e.target.value) } })} /></div>
      </div>
      {canManage && (
        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={() => run(() => saveLoyaltySettingsAction(v), undefined, "Saved")} data-testid="loyalty-save"><Spin on={pending} icon={Save} /> Save rules</Button>
          <Msg error={error} done={done} />
        </div>
      )}
    </div>
  );
}

export function RunNowButton() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" disabled={pending} data-testid="loyalty-run"
        onClick={() => run(() => runLoyaltyNowAction({}), undefined, "Done — points, expiry, reminders and tiers are up to date")}><Spin on={pending} icon={Play} /> Run now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function CampaignForm({ vendors, categories }: { vendors: { id: string; label: string }[]; categories: { id: string; label: string }[] }) {
  const { pending, error, done, run } = useRun();
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const [v, setV] = useState({ name: "", message: "", multiplier: "2", startsAt: today, endsAt: week, vendorIds: [] as string[], categoryIds: [] as string[] });
  const multi = (k: "vendorIds" | "categoryIds", opts: { id: string; label: string }[], label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`cf-${k}`}>{label}</Label>
      <select id={`cf-${k}`} multiple size={5} className="w-full rounded-md border bg-background p-1 text-sm" value={v[k]} onChange={(e) => setV({ ...v, [k]: [...e.target.selectedOptions].map((o) => o.value) })}>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
  return (
    <form className="space-y-3" data-testid="campaign-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveCampaignAction({ name: v.name, message: v.message || null, multiplier: Number(v.multiplier), startsAt: new Date(`${v.startsAt}T00:00:00`), endsAt: new Date(`${v.endsAt}T23:59:59`), vendorIds: v.vendorIds, categoryIds: v.categoryIds, offerIds: [] }), () => setV({ ...v, name: "", message: "" }), "Campaign saved");
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="cf-name">Name</Label><Input id="cf-name" required minLength={3} maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Double points week" /></div>
        <div className="space-y-1"><Label htmlFor="cf-mult">Points ×</Label><Input id="cf-mult" type="number" min={1.1} max={10} step="0.1" value={v.multiplier} onChange={(e) => setV({ ...v, multiplier: e.target.value })} /></div>
        <div />
        <div className="space-y-1"><Label htmlFor="cf-start">From</Label><Input id="cf-start" type="date" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="cf-end">Until</Label><Input id="cf-end" type="date" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="cf-msg">Message to customers (optional)</Label><Input id="cf-msg" maxLength={300} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} placeholder="Double points on everything this week" /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {multi("vendorIds", vendors, "Only these suppliers (none = everything)")}
        {multi("categoryIds", categories, "Only these categories (none = everything)")}
      </div>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending}><Spin on={pending} icon={Sparkles} /> Start campaign</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function EndCampaignButton({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => endCampaignAction({ id }))} data-testid="campaign-end"><StopCircle className="size-4" /> End</Button>
      <Msg error={error} />
    </span>
  );
}

export function AdjustForm({ companyId }: { companyId: string }) {
  const { pending, error, done, run } = useRun();
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" data-testid="adjust-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => adjustPointsAction({ companyId, points: Math.trunc(Number(points)), reason }), () => { setPoints(""); setReason(""); }, "Points changed");
    }}>
      <div className="space-y-1"><Label htmlFor="adj-points">Points (+ to give, − to take)</Label><Input id="adj-points" type="number" step={1} required value={points} onChange={(e) => setPoints(e.target.value)} className="w-40" /></div>
      <div className="min-w-56 flex-1 space-y-1"><Label htmlFor="adj-reason">Reason</Label><Input id="adj-reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill for a late delivery" /></div>
      <Button type="submit" disabled={pending}>Change points</Button>
      <Msg error={error} done={done} />
    </form>
  );
}
