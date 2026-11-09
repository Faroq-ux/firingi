import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OrderList } from "@/components/orders/order-views";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const t = await getTranslations("orders");
  return <OrderList ctx={ctx} as="BUYER" title={t("myOrders")} basePath="/buy/orders/history" params={await searchParams} />;
}
