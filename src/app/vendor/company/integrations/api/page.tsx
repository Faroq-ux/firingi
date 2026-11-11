import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ApiDocsBody } from "@/components/integrations/pages";

export const metadata = { title: "API reference" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "company.integrations.manage");
  return <ApiDocsBody ctx={ctx} />;
}
