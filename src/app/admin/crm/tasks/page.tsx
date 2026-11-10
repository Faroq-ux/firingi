import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { TaskPage } from "@/components/crm/task-page";

export const metadata = { title: "Tasks" };

export default async function Page({ searchParams }: { searchParams: Promise<{ who?: string; show?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  return <TaskPage ctx={ctx} sp={await searchParams} title="Tasks" description="Everything the sales team has to do, including follow-ups." />;
}
