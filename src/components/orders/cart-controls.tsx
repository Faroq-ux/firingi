"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { clearCartAction, placeOrderAction, removeFromCartAction, setCartQtyAction } from "@/server/actions/orders";

export function CartQty({ offerId, qty, min, step }: { offerId: string; qty: number; min: number; step: number }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [value, setValue] = useState(qty);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (q: number) => start(async () => { const r = await setCartQtyAction({ offerId, qty: q }); if (r.ok) { setError(null); router.refresh(); } else setError(r.error); });
  return (
    <div className="flex items-center justify-end gap-1">
      <Input aria-label={t("qty")} type="number" className="h-8 w-20 text-right" min={min} step={step} value={value} onChange={(e) => setValue(Number(e.target.value))} onBlur={() => value !== qty && save(value)} />
      <Button size="icon" variant="ghost" className="size-8" aria-label={t("remove")} disabled={pending} onClick={() => start(async () => { await removeFromCartAction({ offerId }); router.refresh(); })}><Trash2 /></Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function ClearCartButton() {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await clearCartAction({}); router.refresh(); })}>{t("clear")}</Button>;
}

export function CheckoutForm({ addresses, disabled }: { addresses: { id: string; label: string }[]; disabled: boolean }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (addresses.length === 0) return <p className="text-sm text-warning">{t("noDeliveryAddress")}</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await placeOrderAction({ deliveryAddressId: String(fd.get("address")), notes: String(fd.get("notes") || "") || null, requestedDeliveryDate: String(fd.get("date") || "") || null });
          if (r.ok) router.push(`/buy/orders/${r.data.id}?placed=1`);
          else setError(r.error);
        });
      }}
    >
      <div className="space-y-1"><Label htmlFor="address">{t("deliveryAddress")}</Label>
        <Select id="address" name="address">{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="date">{t("requestedDate")}</Label><Input id="date" name="date" type="date" /></div>
      <div className="space-y-1"><Label htmlFor="notes">{t("notes")}</Label><textarea id="notes" name="notes" maxLength={500} className="min-h-16 w-full rounded-md border bg-card p-2 text-sm" /></div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={disabled || pending}>{pending ? t("placing") : t("placeOrder")}</Button>
    </form>
  );
}
