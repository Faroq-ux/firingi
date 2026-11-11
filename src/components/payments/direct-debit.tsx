"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { autoCollectAction, payOrderAction, revokeMandateAction, startMandateAction } from "@/server/actions/payments";

export function SetUpDebitButton({ replace }: { replace?: boolean }) {
  const t = useTranslations("pay");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant={replace ? "outline" : "default"} disabled={pending} data-testid="dd-setup" onClick={() => start(async () => {
        const r = await startMandateAction({});
        if (!r.ok) return setError(r.error);
        if (r.data.action.type === "redirect") window.location.assign(r.data.action.url);
      })}>{pending && <Loader2 className="size-4 animate-spin" aria-hidden />}{t(replace ? "dd.replace" : "dd.setUp")}</Button>
      {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
    </span>
  );
}

export function MandateControls({ id, autoCollect }: { id: string; autoCollect: boolean }) {
  const t = useTranslations("pay");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={autoCollect} disabled={pending} data-testid="dd-auto" onChange={(e) => start(async () => { await autoCollectAction({ id, on: e.target.checked }); router.refresh(); })} />
        {t("dd.autoCollect")}
      </label>
      <Button variant="ghost" className="text-destructive" disabled={pending} data-testid="dd-revoke" onClick={() => { if (confirm(t("dd.revokeConfirm"))) start(async () => { await revokeMandateAction({ id }); router.refresh(); }); }}>{t("dd.revoke")}</Button>
    </div>
  );
}

/** Order page: pay an order that waits for payment. */
export function PayOrderButton({ orderId, label }: { orderId: string; label: string }) {
  const t = useTranslations("pay");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button disabled={pending} data-testid="pay-order" onClick={() => start(async () => {
        const r = await payOrderAction({ orderId });
        if (!r.ok) return setError(r.code === "PAYMENT_IN_PROGRESS" ? t("errors.PAYMENT_IN_PROGRESS") : r.error);
        router.push(`/buy/finance/pay/${r.data.id}`);
      })}>{pending && <Loader2 className="size-4 animate-spin" aria-hidden />}{label}</Button>
      {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
    </span>
  );
}
