import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ExportsBody } from "@/components/integrations/pages";

export const metadata = { title: "Exports" };

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.invoices.view", "buyer.payments.view"]);
  return <ExportsBody ctx={ctx} />;
}
