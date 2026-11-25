"use client";
/**
 * Buying from several wholesalers (customer, 25 languages): the minimum badge under an offer ("In your cart · €12 more
 * to reach the minimum", "Minimum order €100") and, in the cart, one-tap adds of what the customer usually buys
 * from a supplier that is below its minimum.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addToCartAction } from "@/server/actions/orders";
import type { Standing } from "@/lib/cart-help";

/** `target` / `missing` arrive formatted (money for AMOUNT, a count for UNITS). */
/** The line under an offer: where its supplier stands with what is in the cart. */
export function MinBadge({ s }: { s: Standing & { inCart: boolean } }) {
  const t = useTranslations("cartHelp");
  const v = (x: string | null) => x ?? "";
  let text: string | null = null;
  if (s.inCart) {
    if (s.state === "REACHED") text = t("inCartReached");
    else if (s.state === "MINIMUM") text = t(s.unit === "UNITS" ? "inCartMinUnits" : "inCartMin", { missing: v(s.missing), min: v(s.target) });
    else if (s.state === "FREE") text = t(s.unit === "UNITS" ? "inCartFreeUnits" : "inCartFree", { missing: v(s.missing), min: v(s.target) });
    else text = t("inCart");
  } else if (s.state === "MINIMUM") text = t(s.unit === "UNITS" ? "minUnits" : "minOrder", { min: v(s.target) });
  else if (s.state === "FREE") text = t(s.unit === "UNITS" ? "freeFromUnits" : "freeFrom", { min: v(s.target) });
  if (!text) return null;
  const tone = s.inCart ? (s.state === "REACHED" ? "bg-[color:var(--success,#16a34a)]/12 text-[color:var(--success,#16a34a)]" : "bg-primary/10 text-primary") : "bg-muted text-muted-foreground";
  return (
    <div className={`mt-1 inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${tone}`} data-testid={s.inCart ? "min-badge-cart" : "min-badge"}>
      {s.inCart ? (s.state === "REACHED" ? <Check className="size-3 shrink-0" aria-hidden /> : <ShoppingCart className="size-3 shrink-0" aria-hidden />) : null}
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

type Suggestion = { offerId: string; name: string; packaging: string; price: string; qty: number; times: number };

/** In the cart: a supplier below its minimum — what the customer usually buys from it, one tap to add. */
export function TopUp({ supplier, s, items }: { supplier: string; s: Standing; items: Suggestion[] }) {
  const t = useTranslations("cartHelp");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const v = (x: string | null) => x ?? "";
  const key = s.state === "MINIMUM" ? (s.unit === "UNITS" ? "topUpMinUnits" : "topUpMin") : (s.unit === "UNITS" ? "topUpFreeUnits" : "topUpFree");
  const add = (x: Suggestion) => start(async () => {
    setError(null);
    const r = await addToCartAction({ offerId: x.offerId, qty: x.qty });
    if (r.ok) { setDone((d) => new Set(d).add(x.offerId)); router.refresh(); } else setError(r.error);
  });
  return (
    <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm" data-testid="top-up">
      <p className="font-medium">{t(key, { supplier, missing: v(s.missing), min: v(s.target) })}</p>
      {items.length > 0 ? (
        <>
          <p className="text-muted-foreground">{t("usually")}</p>
          <ul className="divide-y rounded-lg border bg-card">
            {items.map((x) => (
              <li key={x.offerId} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="top-up-item">
                <div className="min-w-0 flex-1">
                  <div className="break-words font-medium">{x.name}</div>
                  <div className="text-xs text-muted-foreground">{x.packaging} · {x.price} · {t("times", { n: x.times })}</div>
                </div>
                {done.has(x.offerId)
                  ? <span className="inline-flex items-center gap-1 text-xs text-[color:var(--success,#16a34a)]"><Check className="size-3.5" /> {t("added")}</span>
                  : <Button size="sm" variant="outline" disabled={pending} onClick={() => add(x)} data-testid="top-up-add"><Plus className="size-3.5" /> {t("add", { qty: x.qty })}</Button>}
              </li>
            ))}
          </ul>
        </>
      ) : <p className="text-muted-foreground">{t("browseSupplier")}</p>}
      {error && <p className="text-destructive" role="alert">{error}</p>}
    </div>
  );
}
