"use client";
/** FIRINGI: warehouse feature switches per supplier (English, back office). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resetWarehouseFeaturesAction, setWarehouseFeatureAction } from "@/server/actions/warehouse";

type Feature = "PICK_PACK" | "BINS" | "TRACE" | "RECALLS";
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { setError(null); const r = await fn(); if (r.ok) router.refresh(); else setError(r.error ?? "Error"); });
  return { pending, error, run };
}

export function WarehouseSwitch({ companyId, feature, on, canManage, label }: { companyId: string; feature: Feature; on: boolean; canManage: boolean; label: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={!canManage || pending} data-testid={`wh-switch-${feature}`}
        onClick={() => run(() => setWarehouseFeatureAction({ companyId, feature, on: !on }))}
        className={`relative h-6 w-11 rounded-full border transition-colors disabled:opacity-60 ${on ? "border-transparent bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]" : "bg-muted"}`}>
        <span className={`absolute top-0.5 size-[1.15rem] rounded-full bg-white shadow transition-all ${on ? "left-[1.4rem]" : "left-0.5"}`} />
      </button>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </span>
  );
}

export function ResetWarehouse({ companyId }: { companyId: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resetWarehouseFeaturesAction({ companyId }))}>All on</Button>;
}
