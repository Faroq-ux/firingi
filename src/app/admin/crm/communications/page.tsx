import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ActivityPage } from "@/components/crm/activity-page";

export const metadata = { title: "Communications" };

export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; who?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  return <ActivityPage ctx={ctx} notes={false} sp={await searchParams} />;
}
