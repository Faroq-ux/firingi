"use client";
/** FIRINGI: expiry feature switches per supplier, defaults, and supplier requests (English, back office). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideFeatureRequestAction, resetSupplierFeaturesAction, setInventoryDefaultsAction, setSupplierFeatureAction } from "@/server/actions/inventory";

type Feature = "FEFO" | "EXPIRY_ALERTS" | "MARKDOWN" | "SHOW_EXPIRY";
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => { setError(null); const r = await fn(); if (r.ok) { after?.(); router.refresh(); } else setError(r.error ?? "Error"); });
  return { pending, error, run };
}

export function FeatureSwitch({ companyId, feature, on, canManage, label }: { companyId: string; feature: Feature; on: boolean; canManage: boolean; label: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={!canManage || pending} data-testid={`switch-${feature}`}
        onClick={() => run(() => setSupplierFeatureAction({ companyId, feature, on: !on }))}
        className={`relative h-6 w-11 rounded-full border transition-colors disabled:opacity-60 ${on ? "border-transparent bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]" : "bg-muted"}`}>
        <span className={`absolute top-0.5 size-[1.15rem] rounded-full bg-white shadow transition-all ${on ? "left-[1.4rem]" : "left-0.5"}`} />
      </button>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </span>
  );
}

export function ResetFeatures({ companyId }: { companyId: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resetSupplierFeaturesAction({ companyId }))}>Use defaults</Button>;
}

export function DecideRequest({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" disabled={pending} data-testid="approve-request" onClick={() => run(() => decideFeatureRequestAction({ id, approve: true, reason: reason || null }))}>Approve</Button>
      <Input className="h-8 w-48" placeholder="Reason (needed to reject)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideFeatureRequestAction({ id, approve: false, reason }))}>Reject</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function DefaultsForm({ value, canManage }: { value: { fefo: boolean; expiryAlerts: boolean; markdown: boolean; showExpiry: boolean }; canManage: boolean }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState(value);
  const changed = JSON.stringify(v) !== JSON.stringify(value);
  const rows: [keyof typeof v, string][] = [["fefo", "FEFO picking"], ["expiryAlerts", "Expiry alerts"], ["markdown", "Markdown suggestions"], ["showExpiry", "Best-before shown to customers"]];
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="inventory-defaults">
      {rows.map(([k, label]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" disabled={!canManage} checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{label}</label>)}
      {canManage && <Button size="sm" disabled={!changed || pending} onClick={() => run(() => setInventoryDefaultsAction(v))}>Save defaults</Button>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
