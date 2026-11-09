"use client";
/** Status buttons for buyer / vendor / admin; vendor confirmation with quantities. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { changeOrderStatusAction, confirmOrderAction, resolveExceptionAction } from "@/server/actions/orders";

type S = "PENDING_CONFIRMATION" | "SUPPLIER_PROCESSING" | "READY_FOR_PICKUP" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "RETURNED" | "EXCEPTION";
const NEEDS_REASON = ["CANCELLED", "EXCEPTION", "RETURNED"];

export function StatusActions({ orderId, allowed, confirmLines }: { orderId: string; allowed: S[]; confirmLines?: { id: string; label: string; qty: number }[] }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries((confirmLines ?? []).map((l) => [l.id, l.qty])));
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (r.ok) { setReason(""); setError(null); router.refresh(); } else setError(r.error ?? "Error"); });
  if (allowed.length === 0) return null;
  const confirmable = allowed.includes("SUPPLIER_PROCESSING") && confirmLines;

  return (
    <div className="space-y-3">
      {confirmable && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">{t("vendor.confirmHint")}</p>
          {confirmLines!.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{l.label}</span>
              <Input aria-label={l.label} type="number" min={0} max={l.qty} className="h-8 w-20 text-right" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} />
            </div>
          ))}
          <Button disabled={pending} onClick={() => run(() => confirmOrderAction({ orderId, quantities: qty }))}>{t("vendor.confirm")}</Button>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="reason">{t("vendor.reason")}</Label>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {allowed.filter((s) => !(confirmable && s === "SUPPLIER_PROCESSING")).map((s) => (
          <Button key={s} variant={s === "CANCELLED" || s === "EXCEPTION" || s === "RETURNED" ? "destructive" : "default"} disabled={pending || (NEEDS_REASON.includes(s) && !reason.trim())}
            onClick={() => run(() => changeOrderStatusAction({ orderId, to: s, reason: reason || null }))}>
            {s === "CANCELLED" ? t("cancelOrder") : `${t("vendor.next")}: ${t(`statuses.${s}`)}`}
          </Button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function ResolveException({ exceptionId }: { exceptionId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Input className="h-8" placeholder="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending || note.trim().length < 3} onClick={() => start(async () => { await resolveExceptionAction({ exceptionId, note }); router.refresh(); })}>Resolve</Button>
    </div>
  );
}
