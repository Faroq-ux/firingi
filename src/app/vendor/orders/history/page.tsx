import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { OrderList } from "@/components/orders/order-views";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const t = await getTranslations("orders.vendor");
  return <OrderList ctx={ctx} as="VENDOR" title={t("all")} basePath="/vendor/orders/history" params={await searchParams} />;
}
