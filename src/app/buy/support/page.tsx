import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SupportList } from "@/components/crm/support-portal";

export const metadata = { title: "Help & Support" };

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "company.support.use");
  return <SupportList ctx={ctx} base="/buy/support" />;
}
