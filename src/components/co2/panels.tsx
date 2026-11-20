/** Sustainability & CO₂ (Phase 51) — server panels: the order's footprint, the cart's. */
import { Leaf } from "lucide-react";
import type { Ctx } from "@/server/context";
import { cartFootprint, orderCo2 } from "@/server/co2/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { co2Labels, fill, kgText } from "./labels";

export async function OrderCo2Panel({ ctx, orderId }: { ctx: Ctx; orderId: string }) {
  const c = await orderCo2(ctx, orderId).catch(() => null);
  if (!c) return null;
  const { l, locale } = await co2Labels();
  const rows = [[l.products, c.products], [l.packagingPart, c.packaging], [l.delivery, c.delivery]] as const;
  return (
    <Card data-testid="order-co2">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Leaf className="size-4 text-[color:var(--vivid-teal)]" aria-hidden />{l.orderTitle}</CardTitle></CardHeader>
      <CardContent className="text-sm">
        <dl className="grid max-w-sm grid-cols-2 gap-y-1">
          {rows.flatMap(([k, v]) => [<dt key={`${k}-t`} className="text-muted-foreground">{k}</dt>, <dd key={`${k}-d`} className="text-right tabular-nums">{kgText(v, locale)}</dd>])}
          <dt className="font-semibold">{l.total}</dt><dd className="text-right font-semibold tabular-nums" data-testid="order-co2-total">{kgText(c.total, locale)}</dd>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">{[c.distanceKm != null ? fill(l.distance, { km: Math.round(c.distanceKm) }) : null, c.local ? l["badge.LOCAL"] : null, c.final ? l.final : l.estimate].filter(Boolean).join(" · ")}</p>
      </CardContent>
    </Card>
  );
}

export async function CartCo2({ ctx, lines }: { ctx: Ctx; lines: { offerId: string; qty: number }[] }) {
  const c = await cartFootprint(ctx, lines).catch(() => null);
  if (!c || c.total <= 0) return null;
  const { l, locale } = await co2Labels();
  return <p className="flex items-center gap-1.5 rounded-md bg-[color-mix(in_oklch,var(--vivid-teal)_10%,transparent)] p-2 text-xs" data-testid="cart-co2"><Leaf className="size-3.5 shrink-0 text-[color:var(--vivid-teal)]" aria-hidden />{fill(l.cartTotal, { kg: kgText(c.total, locale) })}</p>;
}
