import Link from "next/link";
import { notFound } from "next/navigation";
import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CancelRun, WorkflowControls, WorkflowEditor, type WorkflowDraft } from "@/components/ai/ops";
import { agentOptions } from "@/server/ai/ops/agents";
import { getWorkflow, mayAutomate } from "@/server/ai/ops/workflows";
import { NotFoundError } from "@/server/errors";
import { DEFAULT_SCHEDULE, ruleSentence, type Condition, type Schedule, type Step, type TriggerKind } from "@/lib/ai-ops";
import { aiPage } from "../../_kit";
import { Status, when } from "../../_ops";

export const metadata = { title: "Automation" };
export const dynamic = "force-dynamic";

export default async function AutomationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await aiPage();
  const { id } = await params;
  const w = await getWorkflow(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const agents = await agentOptions(ctx);
  const canEdit = mayAutomate(ctx);
  const initial: WorkflowDraft = {
    name: w.name, description: w.description ?? "", trigger: w.trigger as TriggerKind, schedule: (w.triggerConfig as { schedule?: Schedule }).schedule ?? DEFAULT_SCHEDULE,
    conditions: w.conditions as Condition[], match: w.match as "ALL" | "ANY", steps: w.steps as unknown as Step[], maxRunsPerDay: w.maxRunsPerDay,
  };
  return (
    <>
      <PageHeader title={w.name} icon={Workflow}
        description={<><span className="break-words">{ruleSentence(w, (x) => agents.find((a) => a.id === x)?.name ?? "an agent")}</span><span className="mt-1 block text-xs">Runs with the rights of {w.ownerName ?? "—"} · <Link className="underline" href="/admin/ai/automation">All automations</Link></span></>}
        actions={<div className="flex flex-wrap items-center gap-2"><Badge variant={w.active ? "success" : "secondary"} data-testid="wf-state">{w.active ? "On" : "Off"}</Badge><WorkflowControls id={w.id} active={w.active} manual={w.trigger === "SCHEDULE" || w.trigger === "MANUAL"} canEdit={canEdit} /></div>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card><CardContent className="pt-6"><WorkflowEditor id={w.id} initial={initial} agents={agents} canEdit={canEdit} /></CardContent></Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Recent runs</CardTitle><Link className="text-sm text-primary hover:underline" href="/admin/ai/automation?tab=LOGS">All logs →</Link></CardHeader>
          <CardContent>
            {!w.runs.length ? <p className="text-sm text-muted-foreground" data-testid="wf-no-runs">No runs yet.</p> : (
              <ul className="divide-y" data-testid="wf-runs">{w.runs.map((r) => {
                const log = (r.log as { step: number; type: string; ok: boolean; text: string }[]) ?? [];
                return (
                  <li key={r.id} className="py-2" data-testid="wf-run" data-status={r.status}>
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm"><Status value={r.status} /><span className="text-xs text-muted-foreground">{r.source.toLowerCase()} · {when(r.startedAt)}</span></summary>
                      <ol className="mt-1 space-y-1 pl-4 text-sm">{log.map((l, i) => <li key={i} className={`break-words ${l.ok ? "" : "text-destructive"}`}>{l.step + 1}. {l.text}</li>)}</ol>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs">{r.link && <Link className="text-primary hover:underline" href={r.link}>Open →</Link>}{canEdit && ["WAITING", "WAITING_APPROVAL"].includes(r.status) && <CancelRun id={r.id} />}</div>
                    </details>
                  </li>
                );
              })}</ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
