/** Follow-ups / Tasks pages. */
import { can } from "@/server/rbac/guard";
import type { Ctx } from "@/server/context";
import { crmTargets, crmTeam, listTasks } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TaskForm } from "./forms";
import { Pills, TaskList } from "./views";

export async function TaskPage({ ctx, kind, sp, title, description }: { ctx: Ctx; kind?: "FOLLOW_UP"; sp: { who?: string; show?: string }; title: string; description: string }) {
  const who = sp.who === "all" ? "all" : "me";
  const show = sp.show === "overdue" || sp.show === "done" ? sp.show : "open";
  const [rows, team, targets] = await Promise.all([
    listTasks(ctx, { kind, assigneeId: who === "me" ? ctx.user.id : undefined, status: show === "done" ? "DONE" : "OPEN", overdue: show === "overdue" }),
    crmTeam(ctx), crmTargets(ctx),
  ]);
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="mb-3 flex flex-wrap items-start gap-3">
        {can(ctx, "admin.crm.manage") && <TaskForm kind={kind ?? "TASK"} team={team.map((t) => ({ id: t.id, label: t.name }))} targets={{ companies: targets.companies.map((c) => ({ id: c.id, label: c.legalName })), leads: targets.leads.map((l) => ({ id: l.id, label: `${l.companyName} (${l.number})` })) }} />}
        <Pills items={[{ value: "me", label: "Mine" }, { value: "all", label: "Team" }]} current={who} param="who" base={{ show }} />
        <Pills items={[{ value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "done", label: "Done" }]} current={show} param="show" base={{ who }} />
      </div>
      <Card><CardContent className="pt-5"><TaskList items={rows} showTarget /></CardContent></Card>
    </>
  );
}
