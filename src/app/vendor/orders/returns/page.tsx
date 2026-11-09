import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RETURN_WINDOW_DAYS } from "@/server/services/returns";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ReturnsList } from "@/components/delivery/delivery-views";

export const metadata = { title: "Returns" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const t = await getTranslations("delivery");
  return (
    <>
      <PageHeader title={t("returns")} description={t("returnIntro", { days: RETURN_WINDOW_DAYS })} />
      <Card><CardContent className="pt-5"><ReturnsList ctx={ctx} as="VENDOR" orderBase="/vendor/orders" /></CardContent></Card>
    </>
  );
}
