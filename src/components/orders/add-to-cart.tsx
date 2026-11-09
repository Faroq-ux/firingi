"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addToCartAction, clearCartAction } from "@/server/actions/orders";

/** Quantity + add button. Handles the one-supplier-per-cart rule with a clear choice. */
export function AddToCart({ offerId, minOrderQty, qtyStep }: { offerId: string; minOrderQty: number; qtyStep: number }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [qty, setQty] = useState(minOrderQty);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "conflict"; text: string } | null>(null);

  const add = () =>
    start(async () => {
      const r = await addToCartAction({ offerId, qty });
      if (r.ok) { setMsg({ kind: "ok", text: t("added") }); router.refresh(); }
      else if (r.code === "CART_OTHER_SUPPLIER" && r.details) setMsg({ kind: "conflict", text: t("otherSupplierFull", { current: r.details.current, next: r.details.next }) });
      else setMsg({ kind: "error", text: r.error });
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input aria-label={t("qty")} type="number" className="w-24" min={minOrderQty} step={qtyStep} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        <Button onClick={add} disabled={pending}><ShoppingCart /> {t("add")}</Button>
      </div>
      {msg?.kind === "ok" && <p className="text-sm text-success" role="status">{msg.text} · <Link href="/buy/orders/cart" className="underline">{t("goToCart")}</Link></p>}
      {msg?.kind === "error" && <p className="text-sm text-destructive" role="alert">{msg.text}</p>}
      {msg?.kind === "conflict" && (
        <div role="alert" className="space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          <p>{msg.text}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/buy/orders/cart" className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-xs font-medium">{t("goToCart")}</Link>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await clearCartAction({}); const r = await addToCartAction({ offerId, qty }); setMsg(r.ok ? { kind: "ok", text: t("added") } : { kind: "error", text: r.error }); router.refresh(); })}>
              {t("clearAndAdd")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
