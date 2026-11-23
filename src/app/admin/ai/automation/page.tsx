import Link from "next/link";
import { CalendarClock, CheckCircle2, Plus, Workflow } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tile } from "@/components/motion/dashboard-kit";
import { ApprovalButtons, CancelRun, WorkflowToggle } from "@/components/ai/ops";
import { listRuns, listSchedules, listWorkflows, mayAutomate, opsSummary } from "@/server/ai/ops/workflows";
import { agentOptions, listApprovals } from "@/server/ai/ops/agents";
import { governance } from "@/server/ai/ops/governance";
import { AGENT_TOOLS, RUN_STATUS_LABEL, TRIGGERS, WORKFLOW_TEMPLATES, ruleSentence, scheduleText, type Schedule, type TriggerKind } from "@/lib/ai-ops";
import { TabLinks, aiPage } from "../_kit";
import { AgentIcon, Status, when } from "../_ops";

export const metadata = { title: "Automation" };
export const dynamic = "force-dynamic";
const TABS = ["WORKFLOWS", "RULES", "APPROVALS", "SCHEDULES", "LOGS"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { WORKFLOWS: "Workflows", RULES: "Rules", APPROVALS: "Approvals", SCHEDULES: "Schedules", LOGS: "Execution logs" };

export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; page?: string; done?: string }> }) {
  const { ctx } = await aiPage();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "WORKFLOWS";
  const [sum, g] = await Promise.all([opsSummary(), governance()]);
  const canEdit = mayAutomate(ctx);
  const nav = <TabLinks testid="auto-tabs" active={tab} href={(k) => `/admin/ai/automation?tab=${k}`} tabs={TABS.map((k) => ({ key: k, label: LABEL[k], ...(k === "APPROVALS" ? { count: sum.pending } : {}) }))} />;
  return (
    <>
      <PageHeader title="Automation" icon={Workflow}
        description="Workflows that run by themselves: when something happens (or on a schedule) and the conditions hold, the steps run in order — notify a team, create a follow-up, ask an AI agent, wait for a person's approval, call another system. Every run is logged."
        actions={canEdit ? <Link className={buttonVariants()} href="/admin/ai/automation/new" data-testid="auto-new"><Plus className="size-4" /> New automation</Link> : undefined} />
      {(!g.automation || !g.enabled) && <p className="mb-4 rounded-xl border border-amber-500/40 p-3 text-sm" data-testid="auto-off">Automation is switched off in <Link className="underline" href="/admin/ai/governance">AI Governance</Link> — nothing runs by itself until it is switched on.</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="auto-kpis">
        <Tile icon={Workflow} label="Automations on" value={sum.active} locale="en" tone="tone-blue" i={0} href="/admin/ai/automation" />
        <Tile icon={CheckCircle2} label="Waiting for approval" value={sum.pending} locale="en" tone="tone-orange" i={1} href="/admin/ai/automation?tab=APPROVALS" testId="auto-pending" />
        <Tile icon={CalendarClock} label="Runs, last 24 h" value={sum.runs24} locale="en" tone="tone-teal" i={2} href="/admin/ai/automation?tab=LOGS" hint={`${sum.failed24} failed`} />
        <Tile icon={CalendarClock} label="Agent runs, last 24 h" value={sum.agentRuns24} locale="en" tone="tone-violet" i={3} href="/admin/ai/agents" hint={`${sum.agents} agents active`} />
      </div>
      {nav}
      {tab === "WORKFLOWS" && <Workflows canEdit={canEdit} />}
      {tab === "RULES" && <Rules canEdit={canEdit} />}
      {tab === "APPROVALS" && <Approvals done={sp.done === "1"} />}
      {tab === "SCHEDULES" && <Schedules />}
      {tab === "LOGS" && <Logs status={sp.status ?? null} page={Number(sp.page) || 1} canEdit={canEdit} />}
    </>
  );

  async function Workflows({ canEdit }: { canEdit: boolean }) {
    const rows = await listWorkflows(ctx);
    if (!rows.length) return <Empty canEdit={canEdit} />;
    return (
      <Card><CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm" data-testid="wf-list">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-3">Automation</th><th className="p-3">When</th><th className="p-3">Steps</th><th className="p-3 text-right">Runs (30 d)</th><th className="p-3">Last run</th><th className="p-3">On</th></tr></thead>
          <tbody>{rows.map((w) => (
            <tr key={w.id} className="border-b last:border-0" data-testid="wf-row" data-name={w.name}>
              <td className="p-3"><Link href={`/admin/ai/automation/${w.id}`} className="font-medium hover:underline">{w.name}</Link>{w.description && <p className="text-xs text-muted-foreground">{w.description}</p>}</td>
              <td className="p-3">{w.trigger === "SCHEDULE" ? scheduleText((w.triggerConfig as { schedule: Schedule }).schedule) : TRIGGERS[w.trigger as TriggerKind]?.label ?? w.trigger}</td>
              <td className="p-3 tabular-nums">{(w.steps as unknown[]).length}</td>
              <td className="p-3 text-right tabular-nums">{w.runs30}{w.failed30 ? <span className="ml-1 text-destructive">({w.failed30} failed)</span> : null}{w.waiting ? <span className="ml-1 text-amber-600">({w.waiting} waiting)</span> : null}</td>
              <td className="p-3 text-xs">{when(w.lastRunAt)}</td>
              <td className="p-3">{canEdit ? <WorkflowToggle id={w.id} active={w.active} /> : <Badge variant={w.active ? "success" : "secondary"}>{w.active ? "on" : "off"}</Badge>}</td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    );
  }

  async function Rules({ canEdit }: { canEdit: boolean }) {
    const [rows, agents] = await Promise.all([listWorkflows(ctx), agentOptions(ctx)]);
    const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "an agent";
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Every automation in one sentence</CardTitle><CardDescription>The rules as they stand. Switch them on or off here; open one to change it.</CardDescription></CardHeader>
          <CardContent>
            {!rows.length ? <p className="text-sm text-muted-foreground">No rules yet — start from a template below.</p> : (
              <ul className="divide-y" data-testid="rule-list">{rows.map((w) => (
                <li key={w.id} className="flex flex-wrap items-start gap-3 py-3 text-sm" data-testid="rule-row">
                  <div className="min-w-0 flex-1 basis-72"><Link href={`/admin/ai/automation/${w.id}`} className="font-medium hover:underline">{w.name}</Link><p className="break-words text-muted-foreground">{ruleSentence(w, name)}</p></div>
                  {canEdit ? <WorkflowToggle id={w.id} active={w.active} /> : <Badge variant={w.active ? "success" : "secondary"}>{w.active ? "on" : "off"}</Badge>}
                </li>
              ))}</ul>
            )}
          </CardContent>
        </Card>
        <Templates canEdit={canEdit} />
      </div>
    );
  }

  function Templates({ canEdit }: { canEdit: boolean }) {
    return (
      <Card>
        <CardHeader><CardTitle>Templates</CardTitle><CardDescription>Ready-made automations. Open one, adjust it and save — it starts switched off.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="wf-templates">
          {WORKFLOW_TEMPLATES.map((t) => (
            <div key={t.key} className="flex flex-col gap-2 rounded-xl border p-3" data-testid="wf-template" data-key={t.key}>
              <p className="font-medium">{t.name}</p>
              <p className="flex-1 text-sm text-muted-foreground">{t.description}</p>
              <p className="break-words text-xs">{ruleSentence({ ...t, triggerConfig: { schedule: t.schedule } })}</p>
              {canEdit && <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/admin/ai/automation/new?template=${t.key}`} data-testid="wf-use-template">Use this template</Link>}
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  function Empty({ canEdit }: { canEdit: boolean }) {
    return <div className="space-y-6"><p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground" data-testid="wf-empty">No automations yet.{canEdit ? " Start from a template or build one from scratch." : ""}</p><Templates canEdit={canEdit} /></div>;
  }

  async function Approvals({ done }: { done: boolean }) {
    const rows = await listApprovals(ctx, done ? "DECIDED" : "PENDING");
    return (
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div><CardTitle>{done ? "Decided" : "Waiting for a person"}</CardTitle><CardDescription>Actions AI agents propose, and approval steps of automations. Approving runs the action with your rights.</CardDescription></div>
          <Link className="text-sm text-primary hover:underline" href={`/admin/ai/automation?tab=APPROVALS${done ? "" : "&done=1"}`}>{done ? "Show waiting" : "Show decided"}</Link>
        </CardHeader>
        <CardContent>
          {!rows.length ? <p className="text-sm text-muted-foreground" data-testid="ap-empty">{done ? "Nothing decided yet." : "Nothing is waiting."}</p> : (
            <ul className="divide-y" data-testid="ap-list">{rows.map((p) => {
              const d = p.detail as Record<string, unknown>;
              return (
                <li key={p.id} className="space-y-2 py-3" data-testid="ap-row" data-source={p.source}>
                  <div className="flex flex-wrap items-start gap-3">
                    {p.agent ? <AgentIcon icon={p.agent.icon} tone={p.agent.tone} size="size-9" /> : <span className="grid size-9 shrink-0 place-items-center rounded-xl border"><Workflow className="size-4" /></span>}
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="break-words font-medium">{p.title}</p>
                      <p className="text-xs text-muted-foreground">{p.agent ? `Proposed by ${p.agent.name}` : p.workflow ? `Automation: ${p.workflow.name}` : p.source.toLowerCase()} · {when(p.createdAt)}{p.status === "PENDING" ? ` · expires ${when(p.expiresAt)}` : ""}</p>
                      {p.reason && <p className="mt-1 break-words text-sm">Why: {p.reason}</p>}
                      {p.source === "AGENT" && (
                        <div className="mt-1 break-words text-sm text-muted-foreground">
                          {p.action === "create_task" && <>Task “{String(d.title)}”, due in {String(d.due_in_days)} day(s). {String(d.notes ?? "")}</>}
                          {p.action === "notify_staff" && <>To {String(d.group)}: “{String(d.title)}” — {String(d.body)}</>}
                          {!AGENT_TOOLS[p.action] && JSON.stringify(d).slice(0, 300)}
                        </div>
                      )}
                      {p.source === "WORKFLOW" && Array.isArray(d.nextSteps) && <p className="mt-1 text-sm text-muted-foreground">If approved: {(d.nextSteps as string[]).join(", then ") || "the automation finishes"}.</p>}
                    </div>
                    <Status value={p.status} />
                  </div>
                  {p.status === "PENDING" && (p.canDecide ? <ApprovalButtons id={p.id} /> : <p className="text-xs text-muted-foreground">You can&apos;t decide this one ({p.permission}).</p>)}
                  {p.status !== "PENDING" && <p className="text-xs text-muted-foreground">{p.decidedBy ? `${p.decidedBy}, ` : ""}{when(p.decidedAt)}{p.note ? ` — ${p.note}` : ""}{p.status === "FAILED" ? ` — ${String((p.result as { error?: string } | null)?.error ?? "")}` : ""}</p>}
                </li>
              );
            })}</ul>
          )}
        </CardContent>
      </Card>
    );
  }

  async function Schedules() {
    const s = await listSchedules(ctx);
    return (
      <div className="space-y-6" data-testid="schedules">
        <Card><CardHeader><CardTitle>Scheduled automations</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          {!s.workflows.length ? <p className="text-sm text-muted-foreground">None — choose “On a schedule” as an automation&apos;s trigger.</p> : (
            <table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Automation</th><th>When</th><th>Next run</th><th>Last run</th><th>On</th></tr></thead>
              <tbody>{s.workflows.map((w) => <tr key={w.id} className="border-t"><td className="py-2"><Link className="hover:underline" href={`/admin/ai/automation/${w.id}`}>{w.name}</Link></td><td>{scheduleText((w.triggerConfig as { schedule: Schedule }).schedule)}</td><td>{w.active ? when(w.nextRunAt) : "—"}</td><td>{when(w.lastRunAt)}</td><td><Badge variant={w.active ? "success" : "secondary"}>{w.active ? "on" : "off"}</Badge></td></tr>)}</tbody></table>
          )}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Scheduled agents</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          {!s.agents.length ? <p className="text-sm text-muted-foreground">None — give an agent a schedule in its settings.</p> : (
            <table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Agent</th><th>When</th><th>Next run</th><th>Active</th></tr></thead>
              <tbody>{s.agents.map((a) => <tr key={a.id} className="border-t"><td className="py-2"><Link className="hover:underline" href={`/admin/ai/agents/${a.id}`}>{a.name}</Link></td><td>{scheduleText(a.schedule as Schedule)}</td><td>{a.active ? when(a.nextRunAt) : "—"}</td><td><Badge variant={a.active ? "success" : "secondary"}>{a.active ? "yes" : "paused"}</Badge></td></tr>)}</tbody></table>
          )}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>AI jobs</CardTitle><CardDescription>The background jobs behind the AI Centre (System Health shows all jobs).</CardDescription></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Job</th><th>Runs</th><th>Last run</th><th>State</th></tr></thead>
            <tbody>{s.jobs.map((j) => <tr key={j.key} className="border-t" data-testid="ai-job"><td className="py-2">{j.label}</td><td>{j.every}</td><td>{when(j.last?.startedAt)}</td><td><Badge variant={j.state === "ok" ? "success" : j.state === "never" ? "secondary" : "warning"}>{j.state}</Badge></td></tr>)}</tbody></table>
        </CardContent></Card>
      </div>
    );
  }

  async function Logs({ status, page, canEdit }: { status: string | null; page: number; canEdit: boolean }) {
    const r = await listRuns(ctx, { status, page });
    const statuses = ["", "DONE", "FAILED", "WAITING_APPROVAL", "WAITING", "REJECTED", "CANCELLED"];
    return (
      <Card>
        <CardHeader className="gap-2"><CardTitle>Execution logs</CardTitle>
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="Status">{statuses.map((s) => <Link key={s} href={`/admin/ai/automation?tab=LOGS${s ? `&status=${s}` : ""}`} className={`rounded-full border px-2 py-0.5 ${s === (status ?? "") ? "border-primary bg-primary/10" : ""}`}>{s ? RUN_STATUS_LABEL[s] : "All"}</Link>)}</nav>
        </CardHeader>
        <CardContent>
          {!r.rows.length ? <p className="text-sm text-muted-foreground" data-testid="log-empty">No runs yet.</p> : (
            <ul className="divide-y" data-testid="log-list">{r.rows.map((x) => {
              const log = (x.log as { step: number; type: string; at: string; ok: boolean; text: string }[]) ?? [];
              return (
                <li key={x.id} className="py-3" data-testid="log-row" data-status={x.status}>
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      <Status value={x.status} /><span className="font-medium">{x.workflow.name}</span>
                      <span className="text-xs text-muted-foreground">{x.source.toLowerCase()} · {when(x.startedAt)}{x.subjectType && x.subjectType !== "Workflow" ? ` · ${Object.values(x.payload as Record<string, unknown>)[0] ?? ""}` : ""}</span>
                    </summary>
                    <ol className="mt-2 space-y-1 pl-4 text-sm">{log.map((l, i) => <li key={i} className={`break-words ${l.ok ? "" : "text-destructive"}`}><span className="text-xs text-muted-foreground">{l.at.slice(11, 19)} · step {l.step + 1} {l.type.toLowerCase()}</span> — {l.text}</li>)}</ol>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">{x.link && <Link className="text-primary hover:underline" href={x.link}>Open what it ran for →</Link>}{canEdit && ["WAITING", "WAITING_APPROVAL"].includes(x.status) && <CancelRun id={x.id} />}</div>
                  </details>
                </li>
              );
            })}</ul>
          )}
          {r.pages > 1 && <nav className="mt-3 flex gap-3 text-sm">{r.page > 1 && <Link href={`/admin/ai/automation?tab=LOGS${status ? `&status=${status}` : ""}&page=${r.page - 1}`}>← Newer</Link>}{r.page < r.pages && <Link href={`/admin/ai/automation?tab=LOGS${status ? `&status=${status}` : ""}&page=${r.page + 1}`}>Older →</Link>}</nav>}
        </CardContent>
      </Card>
    );
  }
}
