import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SupportTicket } from "@/components/crm/support-portal";

export const metadata = { title: "Help & Support" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "company.support.use");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <SupportTicket ctx={ctx} id={id} base="/buy/support" sent={sp.sent === "1"} />;
}
