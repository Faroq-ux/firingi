import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { IntegrationsBody } from "@/components/integrations/pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "company.integrations.manage");
  return <IntegrationsBody ctx={ctx} base={"/buy"} />;
}
