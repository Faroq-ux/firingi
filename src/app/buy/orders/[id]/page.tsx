import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getOrder } from "@/server/services/orders";
import { stockInStatus } from "@/server/inventory/purchased";
import { NotFoundError } from "@/server/errors";
import { OrderDetail } from "@/components/orders/order-views";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StockOrder } from "@/components/inventory/purchased";
import { SaveOrderAsList } from "@/components/buying/controls";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const { id } = await params;
  const order = await getOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  // a wholesaler puts a delivered FIRINGI order into its own stock (lots + best-before from the distributor)
  const stock = await stockInStatus(ctx, id);
  const t = stock ? await getTranslations("purchased") : null;
  return (
    <>
      <OrderDetail ctx={ctx} id={id} placed={(await searchParams).placed === "1"} />
      <div className="mt-4 flex justify-end"><SaveOrderAsList orderId={id} number={order.order.number} /></div>
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
