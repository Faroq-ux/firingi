"use client";
/** "Use in my cart": puts the coupon on the cart (translated messages when it can't). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { applyCouponAction } from "@/server/actions/orders";
import { COUPON_ERRORS } from "@/lib/coupons";

export function UseCoupon({ code, label, done }: { code: string; label: string; done: string }) {
  const t = useTranslations("coupons");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} data-testid={`use-${code}`} onClick={() => start(async () => {
        const r = await applyCouponAction({ code });
        if (r.ok) { setMsg({ ok: true, text: done }); router.refresh(); }
        else setMsg({ ok: false, text: (COUPON_ERRORS as readonly string[]).includes(r.code) ? t(`errors.${r.code}`, { missing: r.details?.missing ?? "", min: r.details?.minimum ?? "" }) : r.error });
      })}>{label}</Button>
      {msg && <span role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</span>}
    </div>
  );
}
