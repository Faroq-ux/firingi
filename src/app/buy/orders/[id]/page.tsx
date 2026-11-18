import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { claimableOrder, claimsForOrder } from "@/server/claims/service";
import { getOrder } from "@/server/services/orders";
import { stockInStatus } from "@/server/inventory/purchased";
import { NotFoundError } from "@/server/errors";
import { OrderDetail } from "@/components/orders/order-views";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StockOrder } from "@/components/inventory/purchased";
import { SaveOrderAsList } from "@/components/buying/controls";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CLAIM_STATUS_TONE } from "@/components/claims/views";
import { OrderDepositsCard } from "@/components/returnables/views";
import { OrderWeightsCard } from "@/components/catchweight/views";
import { OrderColdCard } from "@/components/coldchain/views";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const { id } = await params;
  const order = await getOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  // a wholesaler puts a delivered FIRINGI order into its own stock (lots + best-before from the distributor)
  const stock = await stockInStatus(ctx, id);
  const t = stock ? await getTranslations("purchased") : null;
  // quality claims (Phase 31): report a problem within the window after delivery
  const mayClaim = can(ctx, "buyer.claims.manage");
  const [claimable, claims] = mayClaim ? await Promise.all([claimableOrder(ctx, id).catch(() => null), claimsForOrder(id)]) : [null, []];
  const tc = claimable?.open || claims.length ? await getTranslations("claims") : null;
  return (
    <>
      <OrderDetail ctx={ctx} id={id} placed={(await searchParams).placed === "1"} />
      <div className="mt-4 flex justify-end"><SaveOrderAsList orderId={id} number={order.order.number} /></div>
      <div id="weights"><OrderWeightsCard ctx={ctx} orderId={id} as="BUYER" /></div><OrderColdCard ctx={ctx} orderId={id} as="BUYER" />
      <OrderDepositsCard orderId={id} status={order.order.status} />
      {tc && (
        <Card className="mt-6" data-testid="order-claims">
          <CardHeader><CardTitle>{tc("orderCardTitle")}</CardTitle><CardDescription>{claimable?.open ? tc("orderCardHint", { hours: claimable.windowHours }) : tc("orderCardClosed")}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {claims.length > 0 && <ul className="divide-y text-sm">{claims.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-2"><Link href={`/buy/orders/claims/${x.id}`} className="font-medium text-primary hover:underline">{x.number}</Link><Badge variant="secondary">{tc(`reason.${x.reason}`)}</Badge><Badge variant={CLAIM_STATUS_TONE[x.status]}>{tc(`status.${x.status}`)}</Badge></li>)}</ul>}
            {claimable?.open && claimable.lines.some((l) => l.claimable > 0) && <Link href={`/buy/orders/${id}/claim`} className={buttonVariants({ variant: "outline" })} data-testid="report-problem">{tc("reportProblem")}</Link>}
          </CardContent>
        </Card>
      )}
      {stock && t && (
        <Card className="mt-6" data-testid="stock-in-card">
          <CardHeader><CardTitle>{t("stockTitle")}</CardTitle><CardDescription>{t("stockHint")}</CardDescription></CardHeader>
          <CardContent>
            {stock.purchaseOrder ? <p className="text-sm">{t("viaPo", { number: stock.purchaseOrder.number })} <Link className="font-medium text-primary hover:underline" href={`/vendor/inventory/purchase-orders/${stock.purchaseOrder.id}`}>{stock.purchaseOrder.number} →</Link></p>
              : stock.stocked ? <p className="text-sm text-muted-foreground" data-testid="stocked">{t("stocked")}</p>
              : <StockOrder orderId={id} warehouses={stock.warehouses} />}
          </CardContent>
        </Card>
      )}
    </>
  );
}
