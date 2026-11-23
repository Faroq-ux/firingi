import { notFound } from "next/navigation";
import { Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { haccpAccess, history, recentDeliveries } from "@/server/haccp/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { haccpLabels } from "@/components/haccp/labels";
import { dayText, temp, when } from "@/components/haccp/text";
import { DeliveryForm } from "@/components/haccp/client";

export const metadata = { title: "Delivery Checks" };
export const dynamic = "force-dynamic";

/** Phase 69: check goods on arrival (temperature, packaging, use-by dates); a failed FIRINGI delivery → a claim. */
export default async function FoodSafetyDeliveries() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.haccp.manage", "buyer.haccp.log"]);
  const a = await haccpAccess(ctx.company);
  if (!a.on || !a.s.parts.deliveries) notFound();
  const now = new Date();
  const [{ l, locale }, orders, checks] = await Promise.all([haccpLabels(), recentDeliveries(ctx, now), history(ctx, { from: new Date(now.getTime() - 30 * 86400_000), to: now, kind: "DELIVERY" })]);
  const r = a.s.rules;
  return (
    <>
      <PageHeader title={l.delTitle} description={l.delIntro} icon={Truck} />
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>{l.recentOrders}</CardTitle></CardHeader>
          <CardContent>
            {!orders.length ? <p className="text-sm text-muted-foreground" data-testid="hc-no-orders">{l.noOrders}</p> : (
              <ul className="divide-y">
                {orders.map((o) => (
                  <li key={o.id} className="space-y-2 py-3" data-testid="hc-order-row" data-number={o.number}>
                    <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{o.number}</span><span className="min-w-0 break-words text-muted-foreground">{o.seller} · {dayText(locale, o.at)}</span>{o.checked && <Badge variant="success">{l.checked}</Badge>}</div>
                    {!o.checked && <DeliveryForm l={l} orderId={o.id} seller={o.seller} chilled={r.deliveryChilledMaxC} frozenMax={r.deliveryFrozenMaxC} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card><CardContent className="pt-6"><DeliveryForm l={l} chilled={r.deliveryChilledMaxC} frozenMax={r.deliveryFrozenMaxC} /></CardContent></Card>
        <Card>
          <CardHeader><CardTitle>{l.recentChecks}</CardTitle></CardHeader>
          <CardContent>
            {!checks.length ? <p className="text-sm text-muted-foreground">{l.noEntries}</p> : (
              <ul className="divide-y" data-testid="hc-del-checks">
                {checks.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start gap-2 py-2 text-sm" data-testid="hc-del-row" data-ok={e.ok ? "1" : "0"}>
                    <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{when(locale, e.at)}</span>
                    <span className="min-w-0 flex-1 basis-48 break-words"><span className="font-medium">{e.supplier ?? "—"}</span>{e.product ? ` · ${e.product}` : ""}{e.valueC != null ? ` · ${temp(locale, e.valueC)}` : ""}{e.corrective && <span className="block text-xs">→ {e.corrective}</span>}</span>
                    <Badge variant={e.ok ? "success" : "destructive"}>{e.ok ? l.ok : l.notOk}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
