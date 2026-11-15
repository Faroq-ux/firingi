"use client";
/** Loyalty & rewards controls (Phase 32): points in the cart, points → credit note, the invitation link. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Copy, Gift, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { redeemCreditAction, setCartPointsAction } from "@/server/actions/loyalty";

export type CartLoyalty = { balance: number; requested: number; used: number; euros: string; max: number; reason: "OFF" | "BELOW_MIN" | "NOT_ENOUGH" | "CAPPED" | null };

/** The cart's "use your points" box. */
export function CartPoints({ l, min, maxPct, valueText, eurosText }: { l: CartLoyalty; min: number; maxPct: number; valueText: string; eurosText: string }) {
  const t = useTranslations("loyalty");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [points, setPoints] = useState(String(Math.max(min, Math.min(l.max, l.balance))));
  const [error, setError] = useState<string | null>(null);
  const run = (n: number) => {
    // checked here first so the message is in the customer's language (the server checks again)
    if (n > 0 && n < min) return setError(t("cartBelowMin", { min }));
    if (n > l.balance) return setError(t("cartNotEnough"));
    start(async () => { setError(null); const r = await setCartPointsAction({ points: n }); if (r.ok) router.refresh(); else setError(r.error); });
  };
  if (l.balance < min && !l.requested) return (
    <p className="flex items-center gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground" data-testid="cart-points-few"><Gift className="size-4 shrink-0" aria-hidden /> {t("cartFew", { points: l.balance, min })}</p>
  );
  if (l.requested > 0) return (
    <div className="rounded-lg border border-[color:var(--vivid-violet)] bg-[color-mix(in_oklch,var(--vivid-violet)_8%,transparent)] p-2 text-sm" data-testid="cart-points-applied">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-[color:var(--vivid-violet)]" aria-hidden />
        <span className="flex-1">{l.used > 0 ? t("cartApplied", { points: l.used, amount: eurosText }) : t("cartNone")}</span>
        <Button size="icon" variant="ghost" className="size-7" aria-label={t("cartRemove")} disabled={pending} onClick={() => run(0)} data-testid="cart-points-remove"><X /></Button>
      </div>
      {l.reason === "CAPPED" && <p className="mt-1 text-xs">{t("cartCapped", { points: l.used, pct: maxPct })}</p>}
      {l.reason === "NOT_ENOUGH" && <p role="alert" className="mt-1 text-xs text-destructive">{t("cartNotEnough")}</p>}
      {l.reason === "BELOW_MIN" && <p role="alert" className="mt-1 text-xs text-destructive">{t("cartBelowMin", { min })}</p>}
    </div>
  );
  return (
    <form className="space-y-1" data-testid="cart-points" onSubmit={(e) => { e.preventDefault(); run(Number(points) || 0); }}>
      <Label htmlFor="cart-points-input" className="flex items-center gap-1.5"><Gift className="size-4 text-[color:var(--vivid-violet)]" aria-hidden /> {t("cartTitle")}</Label>
      <p className="text-xs text-muted-foreground">{t("cartBalance", { points: l.balance, value: valueText })} · {t("cartHint", { min, pct: maxPct })}</p>
      <div className="flex gap-2">
        <Input id="cart-points-input" type="number" inputMode="numeric" min={0} step={1} value={points} onChange={(e) => setPoints(e.target.value)} className="w-32" />
        <Button type="submit" variant="outline" disabled={pending}>{t("cartUse")}</Button>
        {l.max >= min && <Button type="button" variant="ghost" disabled={pending} onClick={() => run(l.max)} data-testid="cart-points-max">{t("cartMax", { points: l.max })}</Button>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

/** Points → credit note on the oldest unpaid invoice. */
export function CreditForm({ balance, min, pointValue, locale }: { balance: number; min: number; pointValue: number; locale: string }) {
  const t = useTranslations("loyalty");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [points, setPoints] = useState(String(Math.max(min, Math.floor(balance / 100) * 100)));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const eur = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  if (balance < min) return <p className="text-sm text-muted-foreground" data-testid="credit-few">{t("creditFew", { min })}</p>;
  return (
    <form className="space-y-2" data-testid="credit-form" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await redeemCreditAction({ points: Number(points) || 0 });
        if (r.ok) { setMsg({ ok: true, text: t("creditDone", { number: r.data.number ?? "", amount: eur(Number(r.data.gross)), invoice: r.data.invoice ?? "" }) }); router.refresh(); }
        else setMsg({ ok: false, text: r.error });
      });
    }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor="credit-points">{t("creditPoints")}</Label>
          <Input id="credit-points" type="number" inputMode="numeric" min={min} max={balance} step={1} value={points} onChange={(e) => setPoints(e.target.value)} className="w-36" /></div>
        <span className="pb-2 text-sm text-muted-foreground">= {eur((Number(points) || 0) * pointValue)}</span>
        <Button type="submit" disabled={pending} data-testid="credit-submit">{t("creditButton")}</Button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-[color:color-mix(in_oklch,var(--vivid-teal)_80%,var(--foreground))]" : "text-destructive"}`} data-testid="credit-msg">{msg.text}</p>}
    </form>
  );
}

/** The invitation link, with a copy button. */
export function InviteLink({ code }: { code: string }) {
  const t = useTranslations("loyalty");
  const [copied, setCopied] = useState(false);
  const path = `/register/customer?ref=${code}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("referralCode")}</span>
        <b className="rounded-md bg-muted px-2 py-1 font-mono text-base tracking-widest" data-testid="referral-code">{code}</b>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 text-xs" data-testid="referral-link">{path}</code>
        <Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ } }} data-testid="referral-copy">
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? t("referralCopied") : t("referralCopy")}
        </Button>
      </div>
    </div>
  );
}
