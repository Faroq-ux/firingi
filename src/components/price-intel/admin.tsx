"use client";
/** FIRINGI price-intelligence controls (Phase 29) — English, admin portal. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, MessageSquare, RefreshCw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun, type Opt } from "@/components/shared/run";
import {
  applyCommissionSuggestionAction, approvePriceChangeAction, askSupplierReviewAction, handlePriceAlertAction, rejectPriceChangeAction, runPricingCheckAction, savePriceSettingsAction,
} from "@/server/actions/price-intel";
import type { PriceSettings } from "@/server/price-intel/stats";

const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

export function DecideRequest({ id, noticeDays }: { id: string; noticeDays: number }) {
  const { pending, error, done, run } = useRun();
  const [date, setDate] = useState(plus(noticeDays));
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  return (
    <div className="space-y-2" data-testid="decide-request">
      <div className="flex flex-wrap items-end gap-2">
        {mode === "idle" && <div className="space-y-1"><Label htmlFor={`d-${id}`} className="text-xs">Applies on</Label><Input id={`d-${id}`} type="date" className="h-8 w-40" min={plus(noticeDays)} value={date} onChange={(e) => setDate(e.target.value)} /></div>}
        <Input className="h-8 min-w-48 flex-1" placeholder={mode === "reject" ? "Why? (the supplier sees it)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        {mode === "idle" ? (
          <>
            <Button size="sm" disabled={pending} data-testid="approve-change" onClick={() => run(() => approvePriceChangeAction({ id, effectiveAt: date, note: note || null }), undefined, "Approved — customers told")}><Spin on={pending} icon={Check} />Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setMode("reject")}><X className="size-4" />Reject…</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="destructive" disabled={pending || !note.trim()} data-testid="reject-change" onClick={() => run(() => rejectPriceChangeAction({ id, note }), () => setMode("idle"), "Rejected")}>Confirm rejection</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
          </>
        )}
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}

export function AlertActions({ id, offerId, status }: { id: string; offerId: string; status: string }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status === "OPEN" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => handlePriceAlertAction({ id, to: "ACKNOWLEDGED" }), undefined, "Noted")}><Eye className="size-4" />Seen</Button>}
      <Button size="sm" variant="ghost" disabled={pending} data-testid="dismiss-alert" onClick={() => run(() => handlePriceAlertAction({ id, to: "DISMISSED" }), undefined, "Dismissed")}><X className="size-4" />Dismiss</Button>
      <AskSupplier offerId={offerId} />
      {(error || done) && <Msg error={error} done={done} />}
    </span>
  );
}

export function AskSupplier({ offerId }: { offerId: string }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="outline" disabled={pending || !!done} data-testid="ask-supplier" onClick={() => run(() => askSupplierReviewAction({ offerId }), undefined, "Supplier asked")}><MessageSquare className="size-4" />Ask supplier to review</Button>
      {(error || done) && <Msg error={error} done={done} />}
    </span>
  );
}

export function ApplyCommission({ vendorId, rate }: { vendorId: string; rate: number }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button size="sm" disabled={pending || !!done} data-testid="apply-commission" onClick={() => run(() => applyCommissionSuggestionAction({ vendorId, rate }), undefined, "Commission changed (or sent for a second approval)")}>Set {rate} %</Button>
      {(error || done) && <Msg error={error} done={done} />}
    </span>
  );
}

export function RunPricingCheck() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} data-testid="run-pricing" onClick={() => run(() => runPricingCheckAction({}), undefined, "Checked")}><Spin on={pending} icon={RefreshCw} />Check prices now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function ProductPicker({ options, value }: { options: Opt[]; value: string | null }) {
  const router = useRouter();
  return (
    <div className="flex max-w-xl flex-1 items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label htmlFor="pick-product">Product</Label>
        <Select id="pick-product" value={value ?? ""} onChange={(e) => router.push(e.target.value ? `/admin/pricing/intelligence/history?variant=${e.target.value}` : "/admin/pricing/intelligence/history")}>
          <option value="">— Recent changes everywhere —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      </div>
    </div>
  );
}

export function PriceSettingsForm({ initial }: { initial: PriceSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const num = (k: keyof PriceSettings, label: string, hint: string, max: number, unit: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ps-${k}`}>{label}</Label>
      <div className="flex items-center gap-2"><Input id={`ps-${k}`} type="number" min={0} max={max} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-28" data-testid={`ps-${k}`} /><span className="text-sm text-muted-foreground">{unit}</span></div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(() => savePriceSettingsAction(v), undefined, "Saved"); }}>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Supplier price increases</legend>
        {num("approvalThresholdPct", "Need FIRINGI's approval above", "An increase bigger than this (vs. the current price, any price list) waits for approval. 0 = never.", 100, "%")}
        {num("noticeDays", "Customers told at least", "Approved increases apply this many days later; customers who buy the product are told now.", 60, "days ahead")}
        {num("notifyBuyersDays", "Customers who bought it in the last", "Plus customers with it in an order list or recurring order (and the customers of group / contract lists).", 365, "days")}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Alerts & comparison</legend>
        {num("jumpPct", "Price jump alert at", "Alert when a base price rises this much…", 200, "%")}
        {num("jumpWindowDays", "…within", "…within this many days.", 60, "days")}
        {num("outlierPct", "Far from the market at", "Alert when a price is this far above / below the median of the same product.", 300, "%")}
        {num("minSuppliers", "Compare with at least", "Markets with fewer suppliers aren't compared (suppliers would recognise each other's prices).", 10, "suppliers")}
      </fieldset>
      <div className="flex items-center gap-2"><Button type="submit" disabled={pending} data-testid="save-price-settings"><Spin on={pending} icon={Save} />Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
