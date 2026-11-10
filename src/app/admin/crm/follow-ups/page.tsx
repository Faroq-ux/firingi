import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { TaskPage } from "@/components/crm/task-page";

export const metadata = { title: "Follow-ups" };

export default async function Page({ searchParams }: { searchParams: Promise<{ who?: string; show?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  return <TaskPage ctx={ctx} kind="FOLLOW_UP" sp={await searchParams} title="Follow-ups" description="Calls and visits to come back to — about an account, a lead or a deal." />;
}
