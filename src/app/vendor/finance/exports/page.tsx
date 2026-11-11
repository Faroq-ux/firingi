import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ExportsBody } from "@/components/integrations/pages";

export const metadata = { title: "Exports" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.invoices.view", "vendor.invoices.submit", "vendor.payments.view"]);
  return <ExportsBody ctx={ctx} />;
}
