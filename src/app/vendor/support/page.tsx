import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SupportList } from "@/components/crm/support-portal";

export const metadata = { title: "Help & Support" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "company.support.use");
  return <SupportList ctx={ctx} base="/vendor/support" />;
}
