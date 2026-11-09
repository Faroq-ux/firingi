import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PaymentsView } from "@/components/finance/views";

export const metadata = { title: "Customer Payments" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  return <PaymentsView ctx={ctx} as="ADMIN" title="Customer Payments" direction="INBOUND" withForm />;
}
