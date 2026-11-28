"use client";
import { CheckoutBudgets } from "@/components/multisite/controls";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { Input, Label, Select } from "@/components/ui/input";
import { applyCouponAction, clearCartAction, placeOrderAction, removeCouponAction, removeFromCartAction, setCartQtyAction } from "@/server/actions/orders";
import { Ticket, X } from "lucide-react";
import { COUPON_ERRORS } from "@/lib/coupons";

export function CartQty({ offerId, qty, min, step }: { offerId: string; qty: number; min: number; step: number }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [value, setValue] = useState(qty);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (q: number) => start(async () => { const r = await setCartQtyAction({ offerId, qty: q }); if (r.ok) { setError(null); router.refresh(); } else { setError(r.error); setValue(qty); } });
  const by = Math.max(1, step || 1);
  const bump = (d: number) => { const q = Math.max(min || by, value + d * by); if (q === value) return; setValue(q); save(q); };
  const remove = (e: React.MouseEvent<HTMLButtonElement>) => {
    // the line folds away while the cart reloads
    e.currentTarget.closest("[data-testid='cart-line']")?.classList.add("line-leaving");
    start(async () => { await removeFromCartAction({ offerId }); router.refresh(); });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <div className={`flex h-9 items-center rounded-full border border-[color:var(--glass-border)] bg-[var(--glass-strong)] p-0.5 shadow-xs transition-opacity ${pending ? "opacity-70" : ""}`}>
          <button type="button" aria-label={`${t("qty")} −`} disabled={pending || value - by < (min || by)} onClick={() => bump(-1)} className="grid size-8 place-items-center rounded-full text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-90 disabled:opacity-35"><Minus className="size-3.5" /></button>
          <input aria-label={t("qty")} type="number" inputMode="numeric" className="h-8 w-12 bg-transparent text-center text-sm font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" min={min} step={step} value={value} onChange={(e) => setValue(Number(e.target.value))} onBlur={() => value !== qty && save(value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <button type="button" aria-label={`${t("qty")} +`} disabled={pending} onClick={() => bump(1)} className="grid size-8 place-items-center rounded-full text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-90"><Plus className="size-3.5" /></button>
        </div>
        <Button size="icon" variant="ghost" className="size-8 rounded-full text-muted-foreground hover:text-destructive" aria-label={t("remove")} disabled={pending} onClick={remove}><Trash2 /></Button>
      </div>
      {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
    </div>
  );
}

/** Phone: the total and "Place order" stay in reach at the bottom while scrolling the cart; hidden once the checkout form is on screen. */
export function CartBar({ total, label, disabled }: { total: string; label: string; disabled?: boolean }) {
  const t = useTranslations("orders");
  const [hidden, setHidden] = useState(false);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-testid='bottom-bar']");
    const measure = () => setOffset(bar && getComputedStyle(bar).display !== "none" ? bar.offsetHeight : 0);
    measure(); window.addEventListener("resize", measure);
    const target = document.getElementById("checkout");
    const io = target ? new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { rootMargin: "0px 0px -20% 0px" }) : null;
    if (target && io) io.observe(target);
    return () => { window.removeEventListener("resize", measure); io?.disconnect(); };
  }, []);
  return (
    <Portal>
    <div className={`fixed inset-x-0 z-20 px-3 pb-2 transition-all duration-300 ease-out lg:hidden ${hidden ? "pointer-events-none translate-y-4 opacity-0" : "translate-y-0 opacity-100"}`} style={{ bottom: offset }} data-testid="cart-bar">
      <div className="glass-panel flex items-center gap-3 rounded-2xl border p-2 pl-4 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="truncate text-base font-semibold tabular-nums">{total}</div>
        </div>
        <Button size="lg" className="rounded-xl" disabled={disabled} onClick={() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{t("placeOrder")}</Button>
      </div>
    </div>
    </Portal>
  );
}

export function ClearCartButton() {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="outline" size="sm" className="rounded-full text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => start(async () => { await clearCartAction({}); router.refresh(); })}><Trash2 />{t("clear")}</Button>;
}

/** Phase 50: pay later at checkout — the options with their fee and schedule (texts from the server). */
export type PayLaterChoice = { title: string; payNow: string; note: string; options: { id: string; label: string; detail: string }[] };

export function CheckoutForm({ addresses, disabled, poRequired = false, locale = "pt-PT", payLater = null }: { addresses: { id: string; label: string }[]; disabled: boolean; poRequired?: boolean; locale?: string; payLater?: PayLaterChoice | null }) {
  const t = useTranslations("orders");
  const tm = useTranslations("multisite");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? "");
  const [termId, setTermId] = useState("");
  if (addresses.length === 0) return <p className="text-sm text-warning">{t("noDeliveryAddress")}</p>;
  return (
    <form
      id="checkout"
      className="scroll-mt-24 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await placeOrderAction({ deliveryAddressId: String(fd.get("address")), notes: String(fd.get("notes") || "") || null, requestedDeliveryDate: String(fd.get("date") || "") || null, poReference: String(fd.get("po") || "") || null, payLaterTermId: termId || null });
          if (r.ok) router.push(r.data.approval ? `/buy/orders/approvals/${r.data.approval.id}?sent=1` : `/buy/orders/${r.data.id}?placed=1`);
          else setError(r.error);
        });
      }}
    >
      <div className="space-y-1"><Label htmlFor="address">{t("deliveryAddress")}</Label>
        <Select id="address" name="address" value={addressId} onChange={(e) => setAddressId(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
      <CheckoutBudgets addressId={addressId} locale={locale} />
      <div className="space-y-1"><Label htmlFor="po">{tm("poReference")}{!poRequired && <span className="text-muted-foreground"> ({tm("optional")})</span>}</Label><Input id="po" name="po" maxLength={60} required={poRequired} placeholder="PO-1234" /></div>
      <div className="space-y-1"><Label htmlFor="date">{t("requestedDate")}</Label><Input id="date" name="date" type="date" /></div>
      {payLater && payLater.options.length > 0 && (
        <fieldset className="space-y-1.5 rounded-lg border p-3" data-testid="paylater-choice">
          <legend className="px-1 text-sm font-medium">{payLater.title}</legend>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="paylater" className="mt-0.5" checked={!termId} onChange={() => setTermId("")} /> {payLater.payNow}</label>
          {payLater.options.map((o) => (
            <label key={o.id} className="flex items-start gap-2 text-sm" data-testid="paylater-option">
              <input type="radio" name="paylater" className="mt-0.5" value={o.id} checked={termId === o.id} onChange={() => setTermId(o.id)} />
              <span className="min-w-0"><span className="font-medium">{o.label}</span><span className="block break-words text-xs text-muted-foreground">{o.detail}</span></span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">{payLater.note}</p>
        </fieldset>
      )}
      <div className="space-y-1"><Label htmlFor="notes">{t("notes")}</Label><textarea id="notes" name="notes" maxLength={500} className="min-h-16 w-full rounded-md border bg-card p-2 text-sm" /></div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={disabled || pending}>{pending ? t("placing") : t("placeOrder")}</Button>
    </form>
  );
}

/** Coupon field in the cart: enter / remove a code; the cart shows what it saves or why it doesn't apply. */
export function CouponBox({ coupon }: { coupon: { code: string; ok: boolean; savings: string; savingsText: string; errorText: string | null } | null }) {
  const t = useTranslations("coupons");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const msg = (c: string, fallback: string, d?: Record<string, string> | null) =>
    (COUPON_ERRORS as readonly string[]).includes(c) ? t(`errors.${c}`, { missing: d?.missing ?? "", min: d?.minimum ?? "" }) : fallback;
  if (coupon)
    return (
      <div className={`rounded-lg border p-2 text-sm ${coupon.ok ? "border-[color:var(--vivid-teal)] bg-[color-mix(in_oklch,var(--vivid-teal)_10%,transparent)]" : "border-warning bg-warning/10"}`} data-testid="coupon-applied">
        <div className="flex items-center gap-2">
          <Ticket className="size-4 text-[color:var(--vivid-pink)]" aria-hidden />
          <b className="font-mono tracking-wide">{coupon.code}</b>
          {coupon.ok && Number(coupon.savings) > 0 && <span className="text-[color:color-mix(in_oklch,var(--vivid-teal)_80%,var(--foreground))]">{coupon.savingsText}</span>}
          <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label={t("remove")} disabled={pending} onClick={() => start(async () => { await removeCouponAction({}); router.refresh(); })}><X /></Button>
        </div>
        {coupon.errorText && <p role="alert" className="mt-1 text-xs">{coupon.errorText}</p>}
      </div>
    );
  return (
    <form className="space-y-1" data-testid="coupon-form" onSubmit={(e) => {
      e.preventDefault();
      if (!code.trim()) return;
      start(async () => {
        const r = await applyCouponAction({ code });
        if (r.ok) { setError(null); setCode(""); router.refresh(); } else setError(msg(r.code, r.error, r.details));
      });
    }}>
      <Label htmlFor="coupon">{t("title")}</Label>
      <div className="flex gap-2">
        <Input id="coupon" name="coupon" placeholder={t("placeholder")} className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" variant="outline" disabled={pending || !code.trim()}>{t("apply")}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
