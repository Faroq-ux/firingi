import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { AgentEditor, AgentRunBox, AgentToggle, RateRun, type AgentDraft } from "@/components/ai/ops";
import { Markdown } from "@/components/ai/markdown";
import { getAgent, mayManageAgents } from "@/server/ai/ops/agents";
import { governance } from "@/server/ai/ops/governance";
import { NotFoundError } from "@/server/errors";
import { can } from "@/server/rbac/guard";
import { AGENT_TOOLS, AUTONOMY, DATA_AREAS, scheduleText, tokenCost, type Autonomy, type DataArea, type Effort, type ModelChoice, type Schedule } from "@/lib/ai-ops";
import { Activity, CheckCircle2, Clock, Coins } from "lucide-react";
import { TabLinks, aiPage } from "../../_kit";
import { AgentIcon, Status, k, secs, when } from "../../_ops";

export const metadata = { title: "AI agent" };
export const dynamic = "force-dynamic";
const TABS = ["RUN", "SETTINGS", "PERFORMANCE"] as const;
type Tab = (typeof TABS)[number];

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { ctx } = await aiPage();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "RUN";
  const d = await getAgent(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const g = await governance();
  const a = d.agent, s = d.stats;
  const canEdit = mayManageAgents(ctx);
  const draft: AgentDraft = {
    name: a.name, role: a.role, instructions: a.instructions, icon: a.icon as AgentDraft["icon"], tone: a.tone as AgentDraft["tone"], tools: a.tools, dataAreas: a.dataAreas as DataArea[],
    autonomy: a.autonomy as Autonomy, model: (a.model ?? "default") as ModelChoice, effort: a.effort as Effort, maxRunsPerDay: a.maxRunsPerDay, active: a.active,
    schedule: (a.schedule as Schedule | null) ?? null, scheduleTask: a.scheduleTask,
  };
  const cost = tokenCost(g, s.tokensIn, s.tokensOut);
  return (
    <>
      <PageHeader title={a.name} description={<><span className="block">{a.role}</span><span className="mt-1 block text-xs">{AUTONOMY[a.autonomy as Autonomy]?.label} · {a.schedule ? scheduleText(a.schedule as Schedule) : "no schedule"} · <Link className="underline" href="/admin/ai/agents">All agents</Link></span></>}
        actions={<div className="flex flex-wrap items-center gap-2"><AgentIcon icon={a.icon} tone={a.tone} size="size-9" /><Badge variant={a.active ? "success" : "secondary"} data-testid="ag-state">{a.active ? "active" : "paused"}</Badge>{canEdit && <AgentToggle id={a.id} active={a.active} />}</div>} />
      <TabLinks testid="ag-detail-tabs" active={tab} href={(x) => `/admin/ai/agents/${a.id}?tab=${x}`} tabs={[{ key: "RUN", label: "Run & history", count: d.runs.length }, { key: "SETTINGS", label: "Settings & permissions" }, { key: "PERFORMANCE", label: "Performance" }]} />

      {tab === "RUN" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card><CardHeader><CardTitle>Give it a task</CardTitle><CardDescription>It works through its tools and writes a report.{d.pending ? ` ${d.pending} of its proposals wait for approval.` : ""}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <AgentRunBox id={a.id} defaultTask={a.scheduleTask ?? ""} canRun={can(ctx, ["admin.ai.agents", "admin.ai.approve"])} />
              <div className="text-xs text-muted-foreground"><p>Tools: {a.tools.map((t) => AGENT_TOOLS[t]?.label ?? t).join(", ")}</p><p>Data: {a.dataAreas.map((x) => DATA_AREAS[x as DataArea]?.label).join(", ") || "only AI suggestions"}</p></div>
              {d.pending > 0 && <Link className="text-sm text-primary hover:underline" href="/admin/ai/automation?tab=APPROVALS">Approval queue →</Link>}
            </CardContent></Card>
          <Card><CardHeader><CardTitle>Runs</CardTitle></CardHeader>
            <CardContent>
              {!d.runs.length ? <p className="text-sm text-muted-foreground" data-testid="ag-no-runs">No runs yet.</p> : (
                <ul className="divide-y" data-testid="ag-runs">{d.runs.map((r, i) => {
                  const tools = (r.tools as { name: string; ok: boolean; proposalId?: string; done?: boolean }[] | null) ?? [];
                  return (
                    <li key={r.id} className="py-3" data-testid="ag-run-row" data-status={r.status}>
                      <details open={i === 0}>
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm"><Status value={r.status} /><span className="min-w-0 flex-1 basis-48 truncate">{r.task}</span><span className="text-xs text-muted-foreground">{r.source.toLowerCase()} · {when(r.startedAt)}</span></summary>
                        <div className="mt-2 space-y-2">
                          {r.output && <div className="rounded-lg bg-muted/40 p-3 text-sm" data-testid="ag-output"><Markdown text={r.output} /></div>}
                          {r.error && <p className="text-sm text-destructive">{r.error}</p>}
                          {!!tools.length && <p className="flex flex-wrap gap-1 text-xs">{tools.map((t, j) => <Badge key={j} variant={!t.ok ? "destructive" : t.proposalId ? "warning" : t.done ? "success" : "secondary"}>{AGENT_TOOLS[t.name]?.label ?? t.name}{t.proposalId ? " → for approval" : t.done ? " → done" : ""}</Badge>)}</p>}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>{r.model === "simulated" || !r.byClaude ? "simulated (no AI connected)" : r.model ?? "—"}</span><span>{secs(r.durationMs)}</span><span>{k(r.tokensIn)} in / {k(r.tokensOut)} out</span>{r.status === "DONE" && <RateRun id={r.id} rating={r.rating} />}</div>
                        </div>
                      </details>
                    </li>
                  );
                })}</ul>
              )}
            </CardContent></Card>
        </div>
      )}

      {tab === "SETTINGS" && <Card><CardContent className="pt-6"><AgentEditor id={a.id} initial={draft} canEdit={canEdit} autoActions={g.autoActions} /></CardContent></Card>}

      {tab === "PERFORMANCE" && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ag-kpis">
            <Tile icon={Activity} label="Runs, 30 days" value={s.runs} locale="en" tone="tone-blue" i={0} hint={`${s.failed} failed · ${s.blocked} blocked`} />
            <Tile icon={CheckCircle2} label="Proposals approved" value={s.approvalRate ?? 0} locale="en" tone="tone-teal" i={1} hint={`${s.approved} approved · ${s.rejected} rejected · ${s.up} 👍 ${s.down} 👎`} />
            <Tile icon={Clock} label="Average run (seconds)" value={Math.round(s.avgMs / 100) / 10} locale="en" tone="tone-violet" i={2} />
            <Tile icon={Coins} label="Tokens, 30 days" value={s.tokens} locale="en" tone="tone-orange" i={3} hint={cost === null ? "set prices in AI Governance for costs" : `about €${cost.toFixed(2)}`} />
          </div>
          <Card><CardHeader><CardTitle>Day by day</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm" data-testid="ag-daily"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Day</th><th className="text-right">Runs</th><th className="text-right">Finished</th><th className="text-right">Tokens</th><th className="w-1/3" /></tr></thead>
              <tbody>{d.daily.map((x) => <tr key={x.day} className="border-t"><td className="py-1">{x.day}</td><td className="text-right tabular-nums">{x.runs}</td><td className="text-right tabular-nums">{x.ok}</td><td className="text-right tabular-nums">{k(x.tokens)}</td><td className="pl-3"><div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.min(100, (x.runs / Math.max(1, ...d.daily.map((y) => y.runs))) * 100)}%` }} /></td></tr>)}
                {!d.daily.length && <tr><td colSpan={5} className="py-2 text-muted-foreground">No runs in the last 30 days.</td></tr>}</tbody></table>
          </CardContent></Card>
        </>
      )}
    </>
  );
}
