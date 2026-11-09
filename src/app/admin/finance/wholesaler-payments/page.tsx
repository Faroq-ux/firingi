import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PaymentsView } from "@/components/finance/views";

export const metadata = { title: "Wholesaler Payments" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  return <PaymentsView ctx={ctx} as="ADMIN" title="Wholesaler Payments" direction="OUTBOUND" vendorType="WHOLESALER" withForm />;
}
