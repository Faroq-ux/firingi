import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RETURN_WINDOW_DAYS } from "@/server/services/returns";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ReturnsList } from "@/components/delivery/delivery-views";

export const metadata = { title: "Returns" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.delivery.view"]);
  return (
    <>
      <PageHeader title="Returns" description={`Buyers can request a return within ${RETURN_WINDOW_DAYS} days of delivery. FIRINGI approves; the supplier (or FIRINGI) confirms receipt, which issues the credit note and the vendor's credit statement.`} />
      <Card><CardContent className="pt-5"><ReturnsList ctx={ctx} as="ADMIN" orderBase="/admin/orders" /></CardContent></Card>
    </>
  );
}
