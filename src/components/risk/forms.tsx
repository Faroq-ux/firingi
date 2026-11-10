"use client";
/** Risk reviews, risk settings, approvals, FIRINGI's IBAN (English back office). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions/_action";
import { decideApprovalAction, decideHeldAction, reviewRiskAction, saveApprovalSettingsAction, saveRiskSettingsAction, setIbanAction, withdrawApprovalAction } from "@/server/actions/risk";
import { RISK_RULES, type RiskRule, type RiskSettings } from "@/server/risk/engine";
import type { ApprovalSettings } from "@/server/approvals/gate";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok?: string) => start(async () => {
    const r = await fn();
    if (r.ok) { setMsg(ok ? { ok: true, text: ok } : null); router.refresh(); }
    else setMsg({ ok: r.code === "APPROVAL_REQUIRED", text: r.error });
  });
  return { pending, msg, run };
}
const Msg = ({ msg }: { msg: { ok: boolean; text: string } | null }) => msg && <span role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</span>;

export function HeldDecision({ orderId }: { orderId: string }) {
  const { pending, msg, run } = useAct();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="held-decision">
      <Input aria-label="Note / reason" placeholder="Note (reason needed to cancel — the customer sees it)" className="h-8 min-w-60 flex-1" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => run(() => decideHeldAction({ orderId, decision: "RELEASE", note: note || null }))}>Release to supplier</Button>
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => decideHeldAction({ orderId, decision: "CANCEL", note }))}>Cancel order</Button>
      <Msg msg={msg} />
    </div>
  );
}

export function ReviewButtons({ id }: { id: string }) {
  const { pending, msg, run } = useAct();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="review-buttons">
      <Input aria-label="Note" placeholder="Note (needed for fraud)" className="h-8 min-w-48 flex-1" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewRiskAction({ id, verdict: "CLEARED", note: note || null }))}>Looks fine</Button>
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => reviewRiskAction({ id, verdict: "FRAUD", note }))}>Fraud</Button>
      <Msg msg={msg} />
    </div>
  );
}

export function RiskSettingsForm({ settings }: { settings: RiskSettings }) {
  const { pending, msg, run } = useAct();
  const [v, setV] = useState(settings);
  const num = (k: keyof RiskSettings, label: string, hint?: string) => (
    <div className="space-y-1"><Label htmlFor={`risk-${k}`}>{label}</Label><Input id={`risk-${k}`} name={k} type="number" min={0} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
  );
  const toggle = (r: RiskRule) => setV({ ...v, disabledRules: v.disabledRules.includes(r) ? v.disabledRules.filter((x) => x !== r) : [...v.disabledRules, r] });
  return (
    <div className="space-y-4" data-testid="risk-settings">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="riskEnabled" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Risk checks on</label>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {num("holdScore", "Hold from score", "HIGH: waits for review")}
        {num("flagScore", "Review from score", "MEDIUM: goes through, reviewed after")}
        {num("bigOrderAmount", "Big order (€ incl. VAT)")}
        {num("newAccountDays", "New account = approved less than (days)")}
        {num("velocityOrders", "Many orders = at least")}
        {num("velocityMinutes", "… within (minutes)")}
        {num("spikeFactor", "Much bigger = × usual order")}
        {num("farKm", "Far address (km from the company)")}
      </div>
      <fieldset className="space-y-1"><legend className="text-sm font-medium">Checks</legend>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {RISK_RULES.map((r) => <label key={r.rule} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`rule_${r.rule}`} checked={!v.disabledRules.includes(r.rule)} onChange={() => toggle(r.rule)} /> {r.label} <span className="text-xs text-muted-foreground">(+{r.points})</span></label>)}
        </div>
      </fieldset>
      <div className="flex items-center gap-2"><Button disabled={pending} onClick={() => run(() => saveRiskSettingsAction(v), "Saved")}>Save risk settings</Button><Msg msg={msg} /></div>
    </div>
  );
}

export function ApprovalDecision({ id, canDecide, canWithdraw }: { id: string; canDecide: boolean; canWithdraw: boolean }) {
  const { pending, msg, run } = useAct();
  const [reason, setReason] = useState("");
  if (!canDecide && !canWithdraw) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="approval-decision">
      {canDecide && <>
        <Input aria-label="Reason" placeholder="Reason (needed to reject)" className="h-8 min-w-48 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button size="sm" disabled={pending} onClick={() => run(() => decideApprovalAction({ id, approve: true, reason: reason || null }), "Approved and applied")}>Approve</Button>
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => decideApprovalAction({ id, approve: false, reason }), "Rejected")}>Reject</Button>
      </>}
      {canWithdraw && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawApprovalAction({ id }), "Withdrawn")}>Withdraw</Button>}
      <Msg msg={msg} />
    </div>
  );
}

export function ApprovalSettingsForm({ settings }: { settings: ApprovalSettings }) {
  const { pending, msg, run } = useAct();
  const [v, setV] = useState(settings);
  const num = (k: keyof ApprovalSettings, label: string) => (
    <div className="space-y-1"><Label htmlFor={`ap-${k}`}>{label}</Label><Input id={`ap-${k}`} name={k} type="number" min={0} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></div>
  );
  const box = (k: keyof ApprovalSettings, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={k} checked={!!v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /> {label}</label>;
  return (
    <div className="space-y-4" data-testid="approval-settings">
      {box("enabled", "Four-eyes approvals on")}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {num("creditNoteAbove", "Credit notes above (€)")}
        {num("creditLimitAbove", "Credit limit raised above (€)")}
        {num("paymentDaysAbove", "Payment terms above (days)")}
        {num("offerPercentAbove", "FIRINGI-paid offers above (%)")}
        {num("offerAmountAbove", "… or € off / budget above (€)")}
        {num("paymentAbove", "Payments above (€)")}
      </div>
      <div className="flex flex-wrap gap-4">{box("commissionChanges", "Commission changes")}{box("bankDetails", "FIRINGI's bank details (IBAN)")}{box("staffRoles", "Powerful staff roles")}</div>
      <div className="flex items-center gap-2"><Button disabled={pending} onClick={() => run(() => saveApprovalSettingsAction(v), "Saved")}>Save approval rules</Button><Msg msg={msg} /></div>
    </div>
  );
}

export function IbanForm({ legalEntityId, iban }: { legalEntityId: string; iban: string | null }) {
  const { pending, msg, run } = useAct();
  const [v, setV] = useState(iban ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="iban-form">
      <div className="space-y-1"><Label htmlFor={`iban-${legalEntityId}`}>IBAN on invoices</Label><Input id={`iban-${legalEntityId}`} className="w-80 font-mono" value={v} onChange={(e) => setV(e.target.value)} /></div>
      <Button variant="outline" disabled={pending || v.replace(/\s/g, "") === (iban ?? "")} onClick={() => run(() => setIbanAction({ legalEntityId, iban: v }), "Saved")}>Change IBAN</Button>
      <Msg msg={msg} />
    </div>
  );
}
