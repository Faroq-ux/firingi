"use client";
/** FIRINGI's clearance deal controls (Phase 38, English). */
import { useState } from "react";
import { Ban, Check, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { cancelDealAction, reviewDealAction, saveDealSettingsAction, setTrustedAction } from "@/server/actions/deals";
import { DEAL_KINDS, type DealSettings } from "@/lib/deals";

const KIND: Record<string, string> = { FLASH: "Flash price", BUNDLE: "Multi-buy / bundle", VOLUME: "Volume tiers", LOT: "Whole lot", BEST_OFFER: "Best offer" };

export function ReviewDeal({ id, suggested }: { id: string; suggested: number | null }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  const [pct, setPct] = useState(suggested == null ? "" : String(suggested));
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="review-deal">
      <Input aria-label="Commission on this deal (%)" placeholder="usual %" value={pct} onChange={(e) => setPct(e.target.value)} className="h-8 w-24" data-testid="review-pct" />
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewDealAction({ id, approve: true, note: note || null, commissionPct: pct.trim() === "" ? null : Number(pct) }))} data-testid="review-approve"><Check className="size-4" /> Approve</Button>
      <Input aria-label="Reason" placeholder="Reason (to turn down)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-48" data-testid="review-note" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewDealAction({ id, approve: false, note }))} data-testid="review-reject"><Ban className="size-4" /> Turn down</Button>
      <Msg error={error} />
    </span>
  );
}

export function StopDeal({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelDealAction({ id }))} data-testid="stop-deal"><X className="size-4" /> Stop</Button><Msg error={error} /></span>;
}

export function TrustedSwitch({ companyId, on: initial }: { companyId: string; on: boolean }) {
  const { pending, error, run } = useRun();
  const [on, setOn] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <label className="flex items-center gap-1"><input type="checkbox" checked={on} disabled={pending} onChange={(e) => { const v = e.target.checked; setOn(v); run(async () => { const r = await setTrustedAction({ companyId, on: v }); if (!r.ok) setOn(!v); return r; }); }} data-testid="trusted" /> trusted</label>
      <Msg error={error} />
    </span>
  );
}

export function DealSettingsForm({ initial }: { initial: DealSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const n = (label: string, value: number, set: (x: number) => void, hint: string, id: string, step = 1) => (
    <div className="space-y-1"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" step={step} value={value} onChange={(e) => set(Number(e.target.value))} data-testid={id} /><p className="text-xs text-muted-foreground">{hint}</p></div>
  );
  return (
    <form className="space-y-6" data-testid="deal-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveDealSettingsAction(v), undefined, "Saved"); }}>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">Kinds of deals suppliers may run</legend>
        <div className="flex flex-wrap gap-4">{DEAL_KINDS.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.kinds[k]} onChange={(e) => setV({ ...v, kinds: { ...v.kinds, [k]: e.target.checked } })} data-testid={`kind-${k}`} />{KIND[k]}</label>)}</div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Approval</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="ds-mode">Deals start</Label>
            <Select id="ds-mode" value={v.approval.mode} onChange={(e) => setV({ ...v, approval: { ...v.approval, mode: e.target.value as "ALWAYS" | "AUTO" } })} data-testid="ds-mode">
              <option value="AUTO">By themselves within the limits (the rest waits for FIRINGI)</option>
              <option value="ALWAYS">Only after FIRINGI approves each one</option>
            </Select>
          </div>
          {n("Largest discount approved by itself (%)", v.approval.maxDiscountPct, (x) => setV({ ...v, approval: { ...v.approval, maxDiscountPct: x } }), "Deeper deals wait for FIRINGI.", "ds-maxpct")}
          {n("Longest deal approved by itself (days)", v.approval.maxDays, (x) => setV({ ...v, approval: { ...v.approval, maxDays: x } }), "Longer deals wait for FIRINGI.", "ds-maxdays")}
          <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" className="size-4" checked={v.approval.trustedOnly} onChange={(e) => setV({ ...v, approval: { ...v.approval, trustedOnly: e.target.checked } })} />Only for trusted suppliers</label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {n("Smallest discount (%)", v.minDiscountPct, (x) => setV({ ...v, minDiscountPct: x }), "A deal must be at least this much below the list price.", "ds-minpct", 0.5)}
          {n("Longest deal (days)", v.maxDurationDays, (x) => setV({ ...v, maxDurationDays: x }), "Never longer than this.", "ds-maxdur")}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Clearance — lower commission</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {n("Best-before within (days)", v.clearance.expiryDays, (x) => setV({ ...v, clearance: { ...v.clearance, expiryDays: x } }), "A deal on a lot that expires this soon is a clearance deal.", "ds-expiry")}
          {n("FIRINGI's commission on clearance (%)", v.clearance.commissionPct, (x) => setV({ ...v, clearance: { ...v.clearance, commissionPct: x } }), "On the deal price; never more than the supplier's usual rate. Other deals: usual rate on the deal price.", "ds-clpct", 0.1)}
          <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" className="size-4" checked={v.clearance.overstock} onChange={(e) => setV({ ...v, clearance: { ...v.clearance, overstock: e.target.checked } })} />Overstock counts too (more than 60 days of stock)</label>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Best offer</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {n("Supplier answers within (hours)", v.bestOffer.answerHours, (x) => setV({ ...v, bestOffer: { ...v.bestOffer, answerHours: x } }), "Unanswered offers expire.", "ds-answer")}
          {n("An accepted price holds for (hours)", v.bestOffer.holdHours, (x) => setV({ ...v, bestOffer: { ...v.bestOffer, holdHours: x } }), "The buyer orders within this time.", "ds-hold")}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Telling buyers</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={v.alerts.smart} onChange={(e) => setV({ ...v, alerts: { ...v.alerts, smart: e.target.checked } })} />Buyers who bought the product before</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={v.alerts.watch} onChange={(e) => setV({ ...v, alerts: { ...v.alerts, watch: e.target.checked } })} />Watchlists</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={v.alerts.digest} onChange={(e) => setV({ ...v, alerts: { ...v.alerts, digest: e.target.checked } })} />Daily digest (people who ask for it)</label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {n("'Bought before' = in the last (days)", v.alerts.lookbackDays, (x) => setV({ ...v, alerts: { ...v.alerts, lookbackDays: x } }), "People who switched 'Offers & news' off aren't told (watchlists are their own choice).", "ds-lookback")}
          {n("At most (deal alerts per person per day)", v.alerts.maxPerDay, (x) => setV({ ...v, alerts: { ...v.alerts, maxPerDay: x } }), "", "ds-maxday")}
        </div>
      </fieldset>
      <div className="flex items-center gap-2"><Button type="submit" disabled={pending} data-testid="ds-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
